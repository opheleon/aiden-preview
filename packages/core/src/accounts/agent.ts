import os from 'node:os';

import type { AccountProject, AccountTask, Decision } from '../../../contracts/src/accounts-api.js';
import { flavorFromEnv } from '../../../contracts/src/app-flavor.js';
import { scopeName } from '../../../contracts/src/project-name.js';
import type { Engine } from '../engine.js';
import { type AccountsClient, AccountsError } from './client.js';
import { teamsDebug } from './debug.js';
import { documentFor, localDocument, materialize } from './documents.js';
import { type InventoryProbe, machineState } from './inventory.js';
import { type CompletionReceipt, flushReceipts, saveReceipt, sendReceipt } from './receipts.js';
import { runAccountTask, supportedTaskKinds, type TaskControls } from './runner.js';
import type { AccountSession } from './session.js';
import { syncSetupTasks } from './setup-tasks.js';
import { superviseAttempt } from './supervisor.js';
import { PermanentTaskError } from './task-errors.js';

/** Machine signals only Electron main can read, plus whether local work is running. */
export interface PollInput {
  idleSeconds: number;
  onBattery: boolean;
  busy: boolean;
}

/** The task this machine is working on for its account. */
export interface RunningTask {
  taskId: string;
  title: string;
  projectId: string;
  startedAt: string;
}

/** The last answer from the server, shown on the This machine strip. */
export interface LastAnswer {
  type: Decision['type'];
  reason: string;
  at: string;
}

/** Re-poll quickly after finishing; signed out costs nothing (no network call), so check often. */
const poll = { signedOut: 30, working: 60, error: 120 } as const;

/**
 * This machine's name as members see it; `AIDEN_DEVICE_NAME` overrides it, for example in a demo.
 * Aiden run from source adds "(local build)", so it reads apart from Aiden Beta on the same Mac.
 */
export function deviceName(): string {
  const chosen = process.env.AIDEN_DEVICE_NAME?.trim();
  if (chosen) return chosen.slice(0, 80);
  const host =
    os
      .hostname()
      .replace(/\.local$/, '')
      .slice(0, 66) || 'This Mac';
  // Aiden run from source joins the same beta team as Aiden Beta on the same computer.
  return flavorFromEnv(process.env) === 'local' ? `${host} (local build)` : host;
}

/**
 * Pulls account work for this machine: sends telemetry, runs whatever the server leases through
 * the existing engine on the member's own subscription, heartbeats while it runs, and uploads the
 * result. It never pushes work anywhere; it only answers "what should this machine do next".
 */
export class AccountAgent {
  private running:
    | (RunningTask & { done: Promise<void>; controller: AbortController; progress: string[] })
    | undefined;
  /** Tasks the team stopped while this machine was running them; their results are dropped. */
  private stopped = new Set<string>();
  private last: LastAnswer | undefined;

  /**
   * Wire the agent.
   * @param engine Runs the actual work.
   * @param session Token and preferences.
   * @param client Accounts API.
   * @param inventory Verified tools, connections, and providers.
   * @param clock Time source, injectable for tests.
   */
  constructor(
    private readonly engine: Engine,
    private readonly session: AccountSession,
    private readonly client: AccountsClient,
    private readonly inventory: InventoryProbe,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** What the This machine strip shows. */
  status(): { running: RunningTask | null; last: LastAnswer | null } {
    const current = this.running;
    const running = current
      ? {
          taskId: current.taskId,
          title: current.title,
          projectId: current.projectId,
          startedAt: current.startedAt,
        }
      : null;
    return { running, last: this.last ?? null };
  }

  /** Wait for the current task, if any. Used by tests and shutdown. */
  async idle(): Promise<void> {
    await this.running?.done;
  }

  /** The telemetry sample sent with every poll and heartbeat. */
  async sample(input: PollInput, busy: boolean): Promise<Record<string, unknown>> {
    const [inventory, preferences] = await Promise.all([
      this.inventory.read(),
      this.session.preferences(),
    ]);
    return {
      machine: machineState(input),
      tools: inventory.tools,
      connections: inventory.connections,
      providers: inventory.providers,
      busy,
      pickupEnabled: preferences.pickupEnabled,
      usageCapPct: preferences.usageCapPct,
      appVersion: (process.env.AIDEN_APP_VERSION ?? 'dev').slice(0, 40),
      os: process.platform,
      taskKinds: [...supportedTaskKinds],
    };
  }

  /** Ask once for work. Returns how long to wait before asking again. */
  async poll(input: PollInput): Promise<{ pollAfterSeconds: number }> {
    if (!(await this.session.refreshToken())) return { pollAfterSeconds: poll.signedOut };
    if (this.running) return { pollAfterSeconds: poll.working };
    const preferences = await this.session.preferences();
    try {
      await flushReceipts(this.engine.store, this.client, preferences.deviceId, (id) =>
        this.upload(id),
      );
      const answer = await this.client.next({
        deviceId: preferences.deviceId,
        deviceName: deviceName(),
        sample: await this.sample(input, input.busy),
      });
      this.last = {
        type: answer.decision.type,
        reason: answer.decision.reason,
        at: this.clock().toISOString(),
      };
      if (answer.decision.type === 'hold' || !answer.task || !answer.project)
        return {
          pollAfterSeconds:
            answer.decision.type === 'hold' ? answer.decision.pollAfterSeconds : poll.working,
        };
      this.start(answer.task, answer.project, input, preferences.deviceId);
      return { pollAfterSeconds: poll.working };
    } catch (error) {
      const reason =
        error instanceof AccountsError
          ? error.message
          : 'Aiden could not ask your account for work.';
      this.last = { type: 'hold', reason, at: this.clock().toISOString() };
      return { pollAfterSeconds: poll.error };
    }
  }

  /** Begin a leased task in the background with a heartbeat; the next poll waits for it. */
  private start(
    task: AccountTask,
    project: AccountProject,
    input: PollInput,
    deviceId: string,
  ): void {
    const startedAt = this.clock();
    teamsDebug('task-start', { taskId: task.id, kind: task.kind, projectId: project.id });
    const controller = new AbortController();
    const progress: string[] = [];
    const done = (async () => {
      const supervision = await superviseAttempt({
        task,
        deviceId,
        deviceName: deviceName(),
        client: this.client,
        controller,
        sample: () => this.sample(input, true),
        clock: this.clock,
        progress: (line) =>
          teamsDebug('task-progress', { taskId: task.id, line: line.slice(0, 120) }),
        interrupt: async () => {
          const { runs } = await this.engine.state(task.projectId);
          for (const run of runs) if (this.engine.isActive(run.id)) this.engine.cancel(run.id);
        },
      });
      try {
        await this.execute(task, project, deviceId, startedAt, supervision.controls);
      } finally {
        await supervision.close();
      }
    })()
      .catch(() => {
        // Failed preflight never launches a model; the server independently reconciles its lease.
        this.last = {
          type: 'hold',
          reason: 'The task could not establish execution authority.',
          at: this.clock().toISOString(),
        };
      })
      .finally(() => {
        this.running = undefined;
      });
    this.running = {
      taskId: task.id,
      title: task.title,
      projectId: project.id,
      startedAt: startedAt.toISOString(),
      done,
      controller,
      progress,
    };
  }

  /**
   * Stop a team task this machine is running: cancel its local runs at once and drop its result,
   * so a stopped task never changes the project or uses more of the member's model usage.
   * @param taskId The stopped task; anything else this machine runs is left alone.
   */
  async stop(taskId: string): Promise<void> {
    const running = this.running;
    if (running?.taskId !== taskId) return;
    this.stopped.add(taskId);
    running.controller.abort();
    const { runs } = await this.engine.state(running.projectId);
    const active = runs.filter((run) => this.engine.isActive(run.id));
    for (const run of active) this.engine.cancel(run.id);
    teamsDebug('task-stop', { taskId, cancelledRuns: active.map((run) => run.id) });
  }

  /** Run the task, upload the changed document, and report the outcome; failures go back to the queue. */
  private async execute(
    task: AccountTask,
    project: AccountProject,
    deviceId: string,
    startedAt: Date,
    controls: TaskControls,
  ): Promise<void> {
    /** How long the attempt took; usage readings are not available yet. */
    const outcome = () => ({
      durationSec: Math.max(0, (this.clock().getTime() - startedAt.getTime()) / 1000),
      usageBefore: null,
      usageAfter: null,
      costUsd: null,
    });
    let produced = false;
    try {
      const output = await runAccountTask(this.engine, task, project, controls);
      teamsDebug('task-ran', { taskId: task.id, documentChanged: output.documentChanged });
      if (this.stopped.delete(task.id)) {
        teamsDebug('task-dropped', { taskId: task.id, reason: 'stopped by the team' });
        return;
      }
      controls.signal.throwIfAborted();
      const receipt: CompletionReceipt = {
        taskId: task.id,
        projectId: project.id,
        deviceId,
        attemptId: task.execution!.attemptId,
        result: output.result,
        followUps: output.followUps ?? [],
        ...(output.review ? { review: output.review } : {}),
        ...(output.checks ? { checks: output.checks } : {}),
        outcome: outcome(),
        documentChanged: output.documentChanged,
        ...(output.review ? { review: output.review } : {}),
        status: 'pending',
      };
      await saveReceipt(this.engine.store, receipt);
      produced = true;
      await sendReceipt(this.engine.store, this.client, receipt, (id) => this.upload(id));
      // Queue the person's next setup step (for example Review requirements) for the whole team.
      await syncSetupTasks(this.engine, this.client, project.id).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'The task failed.';
      teamsDebug('task-error', { taskId: task.id, message: message.slice(0, 300) });
      if (this.stopped.delete(task.id)) return;
      if (produced) {
        this.last = {
          type: 'hold',
          reason: 'Work is saved. Waiting to acknowledge completion with the team.',
          at: this.clock().toISOString(),
        };
        return;
      }
      await this.client
        .fail(task.id, {
          deviceId,
          attemptId: task.execution!.attemptId,
          error: message || 'The task failed.',
          outcome: outcome(),
          // Only a failure every machine would hit is permanent; anything else may work elsewhere.
          ...(error instanceof PermanentTaskError ? { permanent: true } : {}),
        })
        .catch(() => undefined);
    }
  }

  /**
   * Upload this machine's document if its requirements or code links changed here, for example
   * after a person answered Aiden's questions or connected code on this machine.
   * @param projectId The team project.
   */
  async share(projectId: string): Promise<void> {
    const { project, baseline } = await localDocument(this.engine, projectId);
    if (!project.account) return;
    const server = (await this.client.project(projectId)).document as {
      baseline?: { id?: string } | null;
      project?: { repositories?: { id: string }[] };
    };
    /** Repository ids in order, to spot a connected or removed repository. */
    const ids = (repos: { id: string }[] | undefined) => (repos ?? []).map((r) => r.id).join();
    if (
      (server.baseline?.id ?? null) === (baseline?.id ?? null) &&
      ids(server.project?.repositories) === ids(project.repositories)
    )
      return;
    await this.upload(projectId);
  }

  /**
   * Upload this machine's document. On a revision conflict, keep the newer project from the
   * server and add this machine's baseline. Either way the local copy is rewritten from what the
   * server accepted, so every member converges on the same revision.
   */
  async upload(projectId: string): Promise<void> {
    const { project, baseline } = await localDocument(this.engine, projectId);
    const revision = project.account?.revision ?? 1;
    // Send the name members see in the sidebar, so the Teams board matches it.
    const name = scopeName(project.context, baseline?.product).slice(0, 200);
    let saved: AccountProject;
    try {
      saved = await this.client.replaceDocument(
        projectId,
        revision,
        documentFor(project, baseline),
        name,
      );
    } catch (error) {
      if (!(error instanceof AccountsError) || error.status !== 409) throw error;
      const current = await this.client.project(projectId);
      const theirs = await materialize(this.engine, current, true);
      if (!theirs) throw error;
      saved = await this.client.replaceDocument(
        projectId,
        current.revision,
        documentFor(theirs, baseline),
        name,
      );
    }
    await materialize(this.engine, saved, true);
    teamsDebug('document-uploaded', { projectId, revision: saved.revision });
  }
}
