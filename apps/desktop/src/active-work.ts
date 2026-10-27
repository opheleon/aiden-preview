import type { WorkerClient } from '../../../packages/core/src/client.js';

/** How often the answer is read again when no worker event arrives, in milliseconds. */
const refreshMs = 5000;

/**
 * Electron main's copy of whether the worker is running anything, for decisions that must be
 * synchronous, such as deferring an update restart or skipping an automatic look. The worker
 * answers from the work it is actually running, so a log line that arrives after a run finished
 * cannot leave this machine busy. Every worker event and a slow timer refresh the answer.
 */
export class ActiveWork {
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private reading: Promise<void> | undefined;
  private again = false;

  /**
   * Bind the worker without reading it yet.
   * @param worker Answers `activeWork` from its own running work.
   * @param intervalMs How often to read again without an event; tests shorten it.
   */
  constructor(
    private readonly worker: Pick<WorkerClient, 'request'>,
    private readonly intervalMs = refreshMs,
  ) {}

  /** Read the worker now, then keep reading on a timer that never holds the app open. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  /** Whether the worker was running anything at its latest answer; false before the first one. */
  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Read the worker again. Calls made during a read share it and add one more read after it, so
   * a run that finishes mid-read is still seen. A failed read keeps the previous answer; the
   * timer tries again.
   */
  refresh(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.read().finally(() => (this.reading = undefined));
    return this.reading;
  }

  /** Read until no further refresh was requested during the previous read. */
  private async read(): Promise<void> {
    do {
      this.again = false;
      try {
        this.busy = (await this.worker.request('activeWork', {})).busy;
      } catch {
        // The worker may be restarting; keep the last answer until the next read.
      }
    } while (this.again);
  }

  /** Stop the timer; a read in progress still settles. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
