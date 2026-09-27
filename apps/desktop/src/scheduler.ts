import path from 'node:path';

import { z } from 'zod/v3';

import { id, type RunEvent } from '../../../packages/contracts/src/index.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import { atomic, optionalJson } from '../../../packages/core/src/storage.js';

export const ScheduleConfigSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(['daily', 'weekly']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(0).max(6),
    includeEstimates: z.boolean(),
  })
  .strict();
/** Explicit opt-in schedule in the computer’s local calendar and time zone. */
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
const ScheduleSchema = ScheduleConfigSchema.extend({
  projectId: id,
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().optional(),
  lastRunId: id.optional(),
  lastStatus: z
    .enum(['running', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted'])
    .optional(),
  message: z.string().optional(),
});
/** Persisted schedule and last-run outcome; interrupted work is never automatically retried. */
export type ProjectSchedule = z.infer<typeof ScheduleSchema>;
export const defaultSchedule: ScheduleConfig = {
  enabled: false,
  frequency: 'daily',
  time: '09:00',
  weekday: 1,
  includeEstimates: true,
};

// Construct calendar dates in the computer's local zone, rather than adding 24 hours.
// Spring DST gaps normalize forward; fall repeated times occur only once per calendar day.
/** Find the next local calendar occurrence, normalizing DST gaps and excluding the current instant. */
export function nextOccurrence(config: ScheduleConfig, after: Date): string | null {
  if (!config.enabled) return null;
  const [hour, minute] = config.time.split(':').map(Number);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(
      after.getFullYear(),
      after.getMonth(),
      after.getDate() + offset,
      hour,
      minute,
      0,
      0,
    );
    if (
      candidate > after &&
      (config.frequency === 'daily' || candidate.getDay() === config.weekday)
    )
      return candidate.toISOString();
  }
  throw new Error('Could not calculate next scheduled run.');
}

/** Serialize local schedules and consume each slot before starting potentially billed worker work. */
export class LocalScheduler {
  private schedules: ProjectSchedule[] = [];
  private queue = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private lastTick = 0;
  private zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private active:
    | {
        projectId: string;
        runId?: string;
        needsReview: boolean;
        stage: 'report' | 'estimate';
      }
    | undefined;
  private readonly file: string;
  /** Bind the worker and injectable clock without starting timers or reading preferences. */
  constructor(
    private options: {
      dataRoot: string;
      worker: Pick<WorkerClient, 'request'>;
      isBusy: () => boolean;
      now?: () => Date;
      onError?: (message: string) => void;
    },
  ) {
    this.file = path.join(options.dataRoot, 'preferences', 'schedules.json');
  }
  /** Read the injected clock so due-time decisions are reproducible in tests. */
  private now() {
    return this.options.now?.() ?? new Date();
  }
  /** Queue state mutations while allowing later operations after a rejected task. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  /** Atomically persist the current schedule state before acknowledging a mutation. */
  private save() {
    return atomic(this.file, { schemaVersion: 1, schedules: this.schedules });
  }
  /** Load validated schedules and mark abandoned runs interrupted; optionally start periodic checks. */
  async start(timer = true): Promise<void> {
    const saved = await optionalJson<unknown>(this.file);
    this.schedules = saved
      ? z
          .object({ schemaVersion: z.literal(1), schedules: z.array(ScheduleSchema) })
          .strict()
          .parse(saved).schedules
      : [];
    const now = this.now();
    this.lastTick = now.getTime();
    for (const schedule of this.schedules) {
      schedule.nextRunAt = nextOccurrence(schedule, now);
      if (schedule.lastStatus === 'running') {
        schedule.lastStatus = 'interrupted';
        schedule.message =
          'The app closed during this run. Review its saved history before retrying.';
      }
    }
    await this.save();
    if (timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() =>
          this.options.onError?.('Local scheduling stopped because its state could not be saved.'),
        );
      }, 15000);
      this.timer.unref();
    }
  }
  /** Return detached schedule records; stopped schedulers reject access until restart. */
  list(): ProjectSchedule[] {
    if (this.closed)
      throw new Error('Scheduling is unavailable. Restart Aiden and check local preferences.');
    return this.schedules.map((schedule) => ({ ...schedule }));
  }
  /** Validate consent and the reviewed baseline, rolling back memory when persistence fails. */
  set(projectId: string, input: ScheduleConfig): Promise<ProjectSchedule> {
    return this.serialize(async () => {
      if (this.closed)
        throw new Error('Scheduling is unavailable. Restart Aiden and check local preferences.');
      id.parse(projectId);
      const config = ScheduleConfigSchema.parse(input);
      if (config.enabled) {
        const state = await this.options.worker.request('state', { projectId });
        if (!state.project || !state.baseline)
          throw new Error(
            'Review and approve this project’s requirements before enabling a schedule.',
          );
        if (
          state.runs.some(
            (run) =>
              run.kind === 'prepare' &&
              run.status === 'review' &&
              run.createdAt > state.baseline!.reviewedAt,
          )
        )
          throw new Error('Review the pending requirements before enabling a schedule.');
      }
      const previous = this.schedules;
      const existing = previous.find((schedule) => schedule.projectId === projectId);
      const next = {
        ...existing,
        ...config,
        projectId,
        nextRunAt: nextOccurrence(config, this.now()),
      };
      this.schedules = [...previous.filter((schedule) => schedule.projectId !== projectId), next];
      try {
        await this.save();
      } catch (e) {
        this.schedules = previous;
        throw e;
      }
      return { ...next };
    });
  }
  /** Consume due slots once, skipping sleep gaps, clock changes, and conflicting active work. */
  tick(): Promise<void> {
    return this.serialize(async () => {
      if (this.closed) return;
      const now = this.now();
      const gap = now.getTime() - this.lastTick;
      this.lastTick = now.getTime();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone !== this.zone || gap < 0) {
        this.zone = zone;
        for (const schedule of this.schedules) schedule.nextRunAt = nextOccurrence(schedule, now);
        await this.save();
        return;
      }
      for (const schedule of this.schedules) {
        if (!schedule.enabled || !schedule.nextRunAt || new Date(schedule.nextRunAt) > now)
          continue;
        schedule.nextRunAt = nextOccurrence(schedule, now);
        schedule.lastRunAt = now.toISOString();
        schedule.lastStatus = 'skipped';
        if (gap > 90000 || gap < 0)
          schedule.message =
            'Missed while the computer was asleep or its clock changed. Waiting for the next scheduled time.';
        else if (this.active || this.options.isBusy())
          schedule.message = 'Another operation was active. Waiting for the next scheduled time.';
        else {
          // Persist the consumed time slot before launching. Failed saves cannot launch work.
          schedule.message = 'Starting scheduled assessment…';
          await this.save();
          await this.launchSchedule(schedule);
          if (this.closed) return;
        }
        await this.save();
      }
    });
  }
  /** Launch an already consumed time slot only after checking the current reviewed baseline. */
  private async launchSchedule(schedule: ProjectSchedule): Promise<void> {
    try {
      const state = await this.options.worker.request('state', {
        projectId: schedule.projectId,
      });
      if (!state.baseline) throw new Error('Approve the project requirements first.');
      if (
        state.runs.some(
          (run) =>
            run.kind === 'prepare' &&
            run.status === 'review' &&
            run.createdAt > state.baseline!.reviewedAt,
        )
      )
        throw new Error('Requirements are waiting for review. Run manually after approval.');
      if (this.closed) return;
      this.active = { projectId: schedule.projectId, needsReview: false, stage: 'report' };
      const result = await this.options.worker.request('report', {
        projectId: schedule.projectId,
      });
      this.active.runId = result.runId;
      schedule.lastRunId = result.runId;
      schedule.lastStatus = 'running';
      schedule.message = 'Scheduled assessment in progress.';
    } catch (e) {
      this.active = undefined;
      schedule.lastStatus = 'failed';
      schedule.message = e instanceof Error ? e.message : 'Could not start assessment.';
    }
  }
  /** Match worker events to the current launch, including events emitted before its ID arrives. */
  isScheduled(event: RunEvent): boolean {
    return (
      !!this.active &&
      (this.active.runId
        ? event.runId === this.active.runId
        : event.projectId === this.active.projectId)
    );
  }
  /** Serialize run outcomes, cancel clarification-dependent work, and start opted-in estimation after cleanup. */
  observe(event: RunEvent): void {
    if (!this.isScheduled(event)) return;
    // Queue behind launch so a very fast worker cannot finish before its run ID is saved.
    void this.serialize(async () => {
      if (!this.active || this.closed) return;
      const active = this.active;
      const schedule = this.schedules.find((row) => row.projectId === active.projectId)!;
      if (event.type === 'clarification') {
        active.needsReview = true;
        schedule.message =
          'This run needs clarification. Start an assessment manually to answer it.';
        await this.options.worker.request('cancel', { runId: event.runId });
        await this.save();
      }
      if (!['completed', 'failed', 'cancelled'].includes(event.type)) return;
      if (
        event.type === 'completed' &&
        event.report &&
        active.stage === 'report' &&
        schedule.enabled &&
        schedule.includeEstimates
      ) {
        active.stage = 'estimate';
        try {
          // Completion is published before runtime cleanup and project-lock release.
          await this.options.worker.request('waitForRun', { runId: event.runId });
          if (this.closed) return;
          delete active.runId;
          const next = await this.options.worker.request('estimate', {
            projectId: active.projectId,
            reportId: event.report.id,
          });
          active.runId = next.runId;
          schedule.message = 'Assessment accepted. Refreshing estimates…';
          await this.save();
          return;
        } catch {
          schedule.message =
            'Assessment accepted, but estimation could not start. The previous estimate was preserved.';
          schedule.lastStatus = 'failed';
        }
      } else {
        schedule.lastStatus = active.needsReview
          ? 'skipped'
          : (event.type as 'completed' | 'failed' | 'cancelled');
        if (!active.needsReview)
          schedule.message =
            event.type === 'completed'
              ? 'Scheduled run completed.'
              : 'Scheduled run stopped. See project history for details; previous accepted artifacts are preserved.';
      }
      this.active = undefined;
      await this.save();
    }).catch(() => {
      this.options.onError?.('Could not update local schedule status.');
    });
  }
  /** Disable future launches and stop the interval without repeating or cancelling accepted worker work. */
  stop(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
  }
}
