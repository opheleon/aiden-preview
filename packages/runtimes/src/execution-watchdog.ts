import type { ExecutionActivity, ExecutionLimits } from '../../contracts/src/accounts-execution.js';

/** A wall-clock watchdog; sleep counts toward deadlines and no status report resets it. */
export class ExecutionWatchdog {
  private lastActivity: number;
  private sequence = 0;
  private readonly tools = new Map<string, number>();

  /** Set the start time once. Lease acknowledgements may renew only the authority deadline. */
  constructor(
    private readonly limits: ExecutionLimits,
    private readonly startedAt: number,
    private leaseExpiresAt: number,
  ) {
    this.lastActivity = startedAt;
  }

  /** Record observed output or tool boundaries, never agent status-tool calls. */
  observe(activity: ExecutionActivity, now: number): void {
    if (activity.type === 'tool-start' && !this.tools.has(activity.id))
      this.tools.set(activity.id, now);
    if (activity.type === 'tool-end') {
      if (!this.tools.has(activity.id)) return;
      this.tools.delete(activity.id);
    }
    this.lastActivity = now;
    this.sequence++;
  }

  /** Renew local authority only after the server has acknowledged the current attempt. */
  renew(expiresAt: number): void {
    this.leaseExpiresAt = expiresAt;
  }

  /** Counter for server-side execution activity; does not expose provider output. */
  activitySequence(): number {
    return this.sequence;
  }

  /** Decide whether to stop, including a small margin before server authority expires. */
  reason(now: number): string | null {
    if (now >= this.leaseExpiresAt - 5000) return 'The task lease could not be renewed.';
    if (now - this.startedAt >= this.limits.absoluteMs)
      return 'The task reached its runtime limit.';
    if ([...this.tools.values()].some((start) => now - start >= this.limits.toolMs))
      return 'A coding tool exceeded its runtime limit.';
    if (!this.tools.size && now - this.lastActivity >= this.limits.idleMs)
      return 'The coding agent stopped producing execution activity.';
    return null;
  }
}
