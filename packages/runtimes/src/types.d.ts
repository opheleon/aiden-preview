import type { RuntimeConfig } from '../../contracts/src/index.js';

/** One isolated provider turn; cancellation must interrupt execution without retrying paid work. */
export type RuntimeRequest = {
  config: RuntimeConfig;
  prompt: string;
  schema: Record<string, unknown>;
  cwd: string;
  tools: { url: string; token: string };
  signal: AbortSignal;
  progress: (message: string) => void;
};
/** Provider-independent structured execution contract used by the workflow engine. */
export interface AgentRuntime {
  run(request: RuntimeRequest): Promise<RuntimeResult>;
}

/** Validated structured output plus the actual provider runtime identity used for this turn. */
export type RuntimeResult = { value: unknown; version: string; model?: string | undefined };
