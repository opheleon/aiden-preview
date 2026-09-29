import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { z } from 'zod/v3';

import type { WorkerMethod, WorkerParams, WorkerResult } from '../../contracts/src/api.js';
import {
  EstimationSnapshotSchema,
  ProductSchema,
  ReportSchema,
  VerificationSummarySchema,
} from '../../contracts/src/index.js';

const eventSchema = z
  .object({
    type: z.enum(['progress', 'clarification', 'review', 'completed', 'failed', 'cancelled']),
    runId: z.string(),
    projectId: z.string().optional(),
    trigger: z.literal('scheduled').optional(),
    stage: z
      .enum([
        'understand',
        'review',
        'sync',
        'discover',
        'assess',
        'summary',
        'report',
        'estimate',
        'verify',
        'complete',
      ])
      .optional(),
    message: z.string().optional(),
    questionId: z.string().optional(),
    question: z.string().optional(),
    product: ProductSchema.optional(),
    report: ReportSchema.optional(),
    estimation: EstimationSnapshotSchema.optional(),
    verification: VerificationSummarySchema.optional(),
  })
  .strict();
const responseSchema = z
  .object({
    id: z.number().int(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string() }).optional(),
  })
  .strict();

/** A request owns its deadline; settling it must clear the timer exactly once. */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
/** Optional process factory supports deterministic transport tests without provider access. */
export interface WorkerClientOptions {
  requestTimeoutMs?: number;
  createProcess?: () => ChildProcessWithoutNullStreams;
}

/** Typed JSON-lines client that rejects interrupted requests without retrying provider work. */
export class WorkerClient extends EventEmitter {
  private seq = 0;
  private pending = new Map<number, PendingRequest>();
  private child: ChildProcessWithoutNullStreams;
  private input: Interface;
  private closed = false;
  private timeout: number;
  private shutdownTimer: ReturnType<typeof setTimeout> | undefined;

  /** Start the worker with the caller's environment; provider execution remains in the worker. */
  constructor(env: NodeJS.ProcessEnv = process.env, options: WorkerClientOptions = {}) {
    super();
    this.timeout = options.requestTimeoutMs ?? 120_000;
    if (!Number.isFinite(this.timeout) || this.timeout <= 0)
      throw new Error('Invalid worker request timeout.');
    const source = import.meta.url.endsWith('.ts');
    const worker = fileURLToPath(new URL(source ? './worker.ts' : './worker.js', import.meta.url));
    this.child =
      options.createProcess?.() ??
      spawn(process.execPath, [...(source ? ['--import', 'tsx'] : []), worker], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    this.child.stderr.resume();
    this.input = createInterface({ input: this.child.stdout });
    this.input.on('line', (line) => this.receive(line));
    this.child.on('error', () => this.fail('Aiden worker could not start.'));
    this.child.on('exit', () => {
      clearTimeout(this.shutdownTimer);
      this.fail('Aiden worker stopped. Reopen the app to resume saved work.');
    });
    this.child.stdin.on('error', () => this.fail('Aiden worker input closed.'));
  }

  /** Validate process output before forwarding events; malformed output ends the transport. */
  private receive(line: string): void {
    if (this.closed) return;
    try {
      if (line.length > 2_000_000) throw new Error('Oversized response.');
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && 'event' in value) {
        this.emit('event', eventSchema.parse(value.event));
        return;
      }
      const response = responseSchema.parse(value);
      const pending = this.pending.get(response.id);
      if (!pending) return; // Late replies to timed-out requests have no remaining consumer.
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) pending.reject(new Error(response.error.message));
      else pending.resolve(response.result);
    } catch {
      this.fail('Aiden worker returned an invalid response. Reopen the app to resume saved work.');
      this.child.kill('SIGTERM');
    }
  }

  /** Reject every pending request once and remove listeners/timers when the transport stops. */
  private fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    this.input.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.emit('workerStopped');
  }

  /** Send once with a deadline; a timeout never automatically retries an operation. */
  request<K extends WorkerMethod>(method: K, params?: WorkerParams<K>): Promise<WorkerResult<K>> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Worker is closed.'));
      const id = ++this.seq;
      const timeout = method === 'waitForRun' ? Math.max(this.timeout, 31 * 60_000) : this.timeout;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            'Worker request timed out. Work may still be running; check its status before retrying.',
          ),
        );
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as WorkerResult<K>),
        reject,
        timer,
      });
      try {
        this.child.stdin.write(
          JSON.stringify({ protocol: '1.0', id, method, params }) + '\n',
          (error) => {
            if (error) this.fail('Aiden worker input closed.');
          },
        );
      } catch {
        this.fail('Aiden worker input closed.');
      }
    });
  }

  /** Stop accepting requests immediately, then allow five seconds for worker cleanup. */
  close(): void {
    if (this.closed) return;
    this.fail('Worker is closed.');
    this.child.stdin.end();
    this.shutdownTimer = setTimeout(() => this.child.kill('SIGTERM'), 5000);
    this.shutdownTimer.unref();
  }
}
