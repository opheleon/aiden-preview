import path from 'node:path';

import { z } from 'zod/v3';

import type { WorkerResult } from '../../../packages/contracts/src/api.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import { atomic, optionalJson } from '../../../packages/core/src/storage.js';

/** How often Aiden reads each repository's selected remote commit while the app is open. */
const pollMs = 60_000;
/** Local hour after which the first check of the day becomes the morning look. */
const morningHour = 8;

const WatchStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Local calendar day (YYYY-MM-DD) of each project's last morning look. */
    mornings: z.record(z.string(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .strict();
/** What made the watcher look. */
type LookTrigger = 'commit' | 'morning' | 'ticket';

/** Persisted watch state; only the day of each morning look is kept. */
type WatchState = z.infer<typeof WatchStateSchema>;

/** Local calendar day in YYYY-MM-DD form, so the morning look follows the computer's time zone. */
export function localDay(date: Date): string {
  /** Two-digit month or day. */
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Keep an eye on each project while Aiden is open. Every minute it reads selected remote commits with
 * guarded Git (no checkout changes) and looks when remote code changed since the last look, plus one morning look a
 * day. It never starts a look while Aiden is already working, and starts at most one per check.
 */
export class ProjectWatcher {
  private state: WatchState = { schemaVersion: 1, mornings: {} };
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | undefined;
  private closed = false;
  private failing = false;
  private readonly file: string;
  /** Bind the worker and injectable clock without starting timers or reading state. */
  constructor(
    private options: {
      dataRoot: string;
      worker: Pick<WorkerClient, 'request'>;
      isBusy: () => boolean;
      now?: () => Date;
      onError?: (message: string) => void;
    },
  ) {
    this.file = path.join(options.dataRoot, 'preferences', 'watch.json');
  }
  /** Read the injected clock so due-time decisions are reproducible in tests. */
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  /** Load saved morning days, then optionally check every minute. A corrupt file starts fresh. */
  async start(timer = true): Promise<void> {
    const parsed = WatchStateSchema.safeParse(await optionalJson(this.file).catch(() => null));
    if (parsed.success) this.state = parsed.data;
    if (!timer) return;
    this.timer = setInterval(() => void this.tick(), pollMs);
    this.timer.unref();
  }
  /** Run one check; overlapping ticks share the check already in progress. */
  tick(): Promise<void> {
    this.running ??= this.check().finally(() => (this.running = undefined));
    return this.running;
  }
  /**
   * Why to look at a project now, or null. New commits always count; otherwise the first check
   * after 08:00 is the morning look, unless Aiden already looked that day.
   */
  private reason(
    projectId: string,
    heads: WorkerResult<'heads'>,
    now: Date,
    tickets: WorkerResult<'syncTickets'>,
  ): LookTrigger | null {
    if (!heads.ready || heads.active) return null;
    if (tickets?.settings?.enabled && tickets.needsAssessment) return 'ticket';
    if (heads.changed) return 'commit';
    const today = localDay(now);
    const lookedToday = !!heads.lastLookAt && localDay(new Date(heads.lastLookAt)) === today;
    const morningDue =
      now.getHours() >= morningHour && !lookedToday && this.state.mornings[projectId] !== today;
    return morningDue ? 'morning' : null;
  }
  /** Look at the first project whose code changed or whose morning look is due. */
  private async check(): Promise<void> {
    if (this.closed) return;
    try {
      const now = this.now();
      for (const project of await this.options.worker.request('projects')) {
        if (this.closed) return;
        if (project.lifecycle?.status === 'closed') continue;
        await this.options.worker.request('reconcileDelivery', { projectId: project.id });
        const tickets = await this.options.worker.request('syncTickets', { projectId: project.id });
        if (this.options.isBusy()) continue;
        const heads = await this.options.worker.request('heads', { projectId: project.id });
        const reason = this.reason(project.id, heads, now, tickets);
        if (!reason) continue;
        await this.options.worker.request('look', { projectId: project.id, reason });
        if (now.getHours() >= morningHour) this.state.mornings[project.id] = localDay(now);
        await atomic(this.file, this.state);
        break;
      }
      this.failing = false;
    } catch {
      // A look that cannot start now is retried on the next check; report only the first failure.
      if (!this.failing)
        this.options.onError?.(
          'Aiden could not check your projects for changes. It will keep trying.',
        );
      this.failing = true;
    }
  }
  /** Stop checking; looks already started keep running. */
  stop(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
  }
}
