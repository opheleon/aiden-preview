import type { ExecutionActivity, ExecutionLimits } from '../../contracts/src/accounts-execution.js';
import type { RuntimeConfig } from '../../contracts/src/index.js';

/** One isolated provider turn; cancellation must interrupt execution without retrying paid work. */
export type RuntimeRequest = {
  /**
   * A coding session in Claude Code or Codex, which owns its tools and coding loop;
   * `directories` are further worktrees it may also work in.
   */
  coding?: { sessionId: string; directories?: string[]; limits?: ExecutionLimits };
  config: RuntimeConfig;
  prompt: string;
  schema: Record<string, unknown>;
  cwd: string;
  /** Loopback endpoint and its exact tools; zero tools marks a reasoning-only turn. */
  tools: { url: string; token: string; names?: readonly string[]; toolCount?: number };
  signal: AbortSignal;
  progress: (message: string) => void;
  /** Observed provider activity, excluding calls to the status MCP. */
  activity?: (activity: ExecutionActivity) => void;
};
/** Provider-independent structured execution contract used by the workflow engine. */
export interface AgentRuntime {
  run(request: RuntimeRequest): Promise<RuntimeResult>;
}

/** Validated structured output plus the actual provider runtime identity used for this turn. */
export type RuntimeResult = { value: unknown; version: string; model?: string | undefined };
