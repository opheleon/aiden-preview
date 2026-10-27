import os from 'node:os';
import path from 'node:path';

import { z } from 'zod/v3';

import type { AccountStatus } from '../../../packages/contracts/src/api.js';
import type { RunEvent } from '../../../packages/contracts/src/index.js';
import { AccountPoller } from '../../../packages/core/src/accounts/poller.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import { atomic, optionalJson } from '../../../packages/core/src/storage.js';

/** What the headless worker shares with `aiden-teams status` and `sign-in`; never a token. */
const HostStatusSchema = z
  .object({
    updatedAt: z.string(),
    signedIn: z.boolean(),
    email: z.string().nullable(),
    deviceName: z.string(),
    /** The Teams sign-in waiting for a person, while signed out. */
    signInUrl: z.string().url().nullable(),
    message: z.string().nullable(),
    running: z
      .object({
        taskId: z.string(),
        title: z.string(),
        projectId: z.string(),
        startedAt: z.string(),
      })
      .nullable(),
    last: z
      .object({ type: z.enum(['assign', 'hold']), reason: z.string(), at: z.string() })
      .nullable(),
  })
  .strict();

/** The headless worker's last published state. */
export type HostStatus = z.infer<typeof HostStatusSchema>;

/** Signed out, checking costs no network call, so check often to pick up a finished sign-in. */
const signedOutMs = 5_000;
/** Signed in, each check reads the account, so check about as often as the poller asks for work. */
const signedInMs = 60_000;

/** Where the headless worker publishes its state inside the Aiden data folder. */
export function statusFile(root: string): string {
  return path.join(root, 'teams-worker', 'status.json');
}

/** The published state, or null when the worker has not written one or it cannot be read. */
export async function readStatus(root: string): Promise<HostStatus | null> {
  const parsed = HostStatusSchema.safeParse(await optionalJson(statusFile(root)).catch(() => null));
  return parsed.success ? parsed.data : null;
}

/**
 * Check a pasted browser address before forwarding it to the waiting loopback sign-in, so the
 * command never requests anything but this machine's registered Teams callback.
 * Example: `http://127.0.0.1:53682/oauth/callback?code=abc&state=xyz`.
 */
export function loopbackCallback(pasted: string, ports: number[]): URL {
  const problem = new Error(
    'Paste the whole address your browser ended on. It starts with http://127.0.0.1: and contains /oauth/callback.',
  );
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    throw problem;
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !ports.includes(Number(url.port)) ||
    url.pathname !== '/oauth/callback' ||
    !url.searchParams.get('state') ||
    url.username ||
    url.password
  )
    throw problem;
  return url;
}

/** The worker requests and events a host needs; tests replace the process. */
export type HostWorker = Pick<WorkerClient, 'request' | 'on' | 'close'>;

/**
 * Runs Aiden as a Teams machine with no desktop: asks the account for work on the server's schedule,
 * keeps a Teams sign-in waiting while signed out, and publishes a status file and log lines. It is
 * the headless counterpart of Electron main for Linux servers such as a Fly.io machine.
 */
export class TeamsHost {
  private readonly runs = new Set<string>();
  private readonly codingJobs = new Set<string>();
  private readonly poller: AccountPoller;
  private timer?: ReturnType<typeof setTimeout>;
  private signInUrl: string | null = null;
  private logged = new Map<string, string>();
  private closed = false;

  /**
   * Bind the worker and outputs without starting timers.
   * @param options Host dependencies.
   * @param options.worker The Aiden worker process client.
   * @param options.root Aiden data folder, where the status file is written.
   * @param options.log Writes one line to the service log.
   * @param options.now Clock, injectable for tests.
   */
  constructor(
    private readonly options: {
      worker: HostWorker;
      root: string;
      log: (line: string) => void;
      now?: () => Date;
    },
  ) {
    this.poller = new AccountPoller({
      worker: options.worker,
      isBusy: () => this.runs.size > 0 || this.codingJobs.size > 0,
      // Nobody uses a server's keyboard, so it has been idle since it booted.
      idleSeconds: () => os.uptime(),
      onBattery: () => false,
    });
  }

  /** Follow worker activity, start asking for work, and start the status loop. */
  start(): void {
    this.options.worker.on('event', (event: RunEvent) => this.observe(event));
    this.poller.start();
    void this.loop();
  }

  /** Track running work the same way the desktop does, so the server is told when this machine is busy. */
  private observe(event: RunEvent): void {
    if (event.type === 'coding') {
      if (event.codingActive) this.codingJobs.add(event.runId);
      else this.codingJobs.delete(event.runId);
    }
    if (event.type === 'progress' || event.type === 'activity') this.runs.add(event.runId);
    if (['review', 'completed', 'failed', 'cancelled'].includes(event.type))
      this.runs.delete(event.runId);
  }

  /** Check, then schedule the next check; a failed check is logged and retried on schedule. */
  private async loop(): Promise<void> {
    let wait = signedInMs;
    try {
      wait = (await this.check()).signedIn ? signedInMs : signedOutMs;
    } catch (error) {
      this.note('error', error instanceof Error ? error.message : 'Status check failed.');
    }
    if (this.closed) return;
    this.timer = setTimeout(() => void this.loop(), wait);
  }

  /** Read the account state, keep a sign-in waiting while signed out, and publish the result. */
  async check(): Promise<HostStatus> {
    const { worker, root } = this.options;
    let status = await worker.request('accountStatus');
    if (status.signedIn) this.signInUrl = null;
    else if (!status.signingIn || !this.signInUrl) {
      this.signInUrl = (await worker.request('accountSignIn')).authUrl;
      status = { ...status, signingIn: true };
    }
    const published = this.view(status);
    await atomic(statusFile(root), published);
    this.report(published);
    return published;
  }

  /** The published form of an account status. */
  private view(status: AccountStatus): HostStatus {
    return {
      updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
      signedIn: status.signedIn,
      email: status.email,
      deviceName: status.deviceName,
      signInUrl: status.signedIn ? null : this.signInUrl,
      message: status.message,
      running: status.running,
      last: status.last,
    };
  }

  /** Log what changed since the last check, once per change. */
  private report(status: HostStatus): void {
    this.note(
      'account',
      status.signedIn
        ? `Signed in to Aiden Teams as ${status.email ?? 'an unknown address'} on ${status.deviceName}.`
        : 'Signed out of Aiden Teams. Run aiden-teams sign-in on this machine to sign in.',
    );
    if (status.message) this.note('message', status.message);
    if (status.signInUrl) this.note('signIn', `Teams sign-in waiting: ${status.signInUrl}`);
    this.note(
      'running',
      status.running ? `Working on "${status.running.title}".` : 'No team task running.',
    );
    if (status.last) this.note('last', `Last answer: ${status.last.type}, ${status.last.reason}`);
  }

  /** Write a line only when its text differs from the last line of the same kind. */
  private note(kind: string, line: string): void {
    if (this.logged.get(kind) === line) return;
    this.logged.set(kind, line);
    this.options.log(line);
  }

  /** Stop asking for work and close the worker, which checkpoints any running task. */
  async stop(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.poller.stop();
    await this.options.worker.close();
  }
}
