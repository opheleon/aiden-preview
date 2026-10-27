import type { WorkerClient } from '../client.js';

/** Bounds on how often this machine asks its account for work. */
const minimumSeconds = 15;
/** Check in within the three-minute presence window, including with pickup disabled. */
const maximumSeconds = 60;

/**
 * Ask the account for work on the schedule the server suggests. The host process owns this timer
 * because only it can read idle time and power state (Electron main on a desktop, the headless
 * Teams worker on a server); the worker does the asking and the work.
 * Signed out, the worker answers immediately with a long interval and makes no network call.
 */
export class AccountPoller {
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private asking: Promise<void> | undefined;

  /** Bind the worker and the machine signals without starting the timer. */
  constructor(
    private readonly options: {
      worker: Pick<WorkerClient, 'request'>;
      isBusy: () => boolean;
      idleSeconds: () => number;
      onBattery: () => boolean;
    },
  ) {}

  /** Ask once now, then keep asking; also resumes a poller that was stopped. */
  start(): void {
    this.closed = false;
    this.schedule(5);
  }

  /** Ask immediately, for example right after sign-in or a pickup change. */
  nudge(): void {
    this.schedule(0);
  }

  /** Replace the pending timer. */
  private schedule(seconds: number): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.asking = this.tick().finally(() => (this.asking = undefined));
    }, seconds * 1000);
    this.timer.unref();
  }

  /** One poll; a failure waits the longest interval rather than retrying hot. */
  async tick(): Promise<void> {
    let wait = maximumSeconds;
    try {
      const answer = await this.options.worker.request('accountPoll', {
        idleSeconds: this.options.idleSeconds(),
        onBattery: this.options.onBattery(),
        busy: this.options.isBusy(),
      });
      wait = Math.min(maximumSeconds, Math.max(minimumSeconds, answer.pollAfterSeconds));
    } catch {
      // The worker records nothing sensitive; the next tick tries again.
    }
    this.schedule(wait);
  }

  /** Stop asking; a task already running finishes in the worker. */
  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Stop asking and wait for a request already on its way, so the caller knows whether that last
   * answer started a task before it shuts the machine down.
   */
  async settle(): Promise<void> {
    this.stop();
    await this.asking;
  }
}
