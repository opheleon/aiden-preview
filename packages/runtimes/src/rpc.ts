import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import { z } from 'zod/v3';

import { publicError } from './environment.js';

const messageSchema = z
  .object({
    id: z.union([z.number().int(), z.string()]).optional(),
    method: z.string().optional(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string() }).passthrough().optional(),
    params: z.unknown().optional(),
  })
  .passthrough();
/** Transport envelopes are validated; method-specific payloads remain unknown until parsed. */
export type RpcMessage = z.infer<typeof messageSchema>;

/** Codex JSON-lines transport with bounded requests and fail-closed message handling. */
export class RpcClient {
  process: ChildProcessWithoutNullStreams;
  private seq = 0;
  private input: Interface;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  listeners = new Set<(message: RpcMessage) => void>();
  closed = false;

  /** Start one provider process with the caller’s sanitized environment and permission overrides. */
  constructor(env: NodeJS.ProcessEnv, cwd: string, overrides: string[] = []) {
    this.process = spawn(
      process.env.AIDEN_CODEX_BINARY || 'codex',
      ['app-server', '--stdio', ...overrides.flatMap((value) => ['-c', value])],
      { cwd, env, stdio: 'pipe' },
    );
    this.process.stderr.resume();
    this.input = createInterface({ input: this.process.stdout });
    this.input.on('line', (line) => this.receive(line));
    this.process.once('error', () =>
      this.fail(new Error('Codex could not start. Install Codex or configure AIDEN_CODEX_BINARY.')),
    );
    this.process.once('exit', () => this.fail(new Error('Codex process exited.')));
    this.process.stdin.on('error', () => this.fail(new Error('Codex input closed.')));
  }

  /** Reject malformed envelopes and unsupported server requests before notifying consumers. */
  private receive(line: string): void {
    if (this.closed) return;
    try {
      if (line.length > 2_000_000) throw new Error('Oversized runtime message.');
      const message = messageSchema.parse(JSON.parse(line));
      if (message.id !== undefined && message.method) {
        this.send({
          id: message.id,
          error: { code: -32601, message: 'Aiden does not allow this operation.' },
        });
      } else if (typeof message.id === 'number') {
        this.settle(message.id, message);
      } else if (!message.method) {
        throw new Error('Invalid runtime response.');
      }
      for (const listener of this.listeners) listener(message);
    } catch {
      this.fail(new Error('Codex returned an invalid response. No work was retried.'));
    }
  }

  /** Settle a live request once; late responses to timed-out requests are ignored. */
  private settle(id: number, message: RpcMessage): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (message.error) pending.reject(new Error(publicError(message.error.message)));
    else pending.resolve(message.result);
  }

  /** Reject outstanding work and emit exactly one exit notification without raw process output. */
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.terminate();
    this.input.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'aiden/exit' });
    this.listeners.clear();
  }

  /** Write one envelope; a broken input pipe closes outstanding requests without retry. */
  send(message: unknown): void {
    if (this.closed) return;
    try {
      this.process.stdin.write(JSON.stringify(message) + '\n', (error) => {
        if (error) this.fail(new Error('Codex input closed.'));
      });
    } catch {
      this.fail(new Error('Codex input closed.'));
    }
  }

  /** Bound each call independently; callers must validate the returned method-specific payload. */
  request(method: string, params: unknown = {}, timeout = 60000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Runtime is closed.'));
      if (!Number.isFinite(timeout) || timeout <= 0)
        return reject(new Error('Invalid runtime request timeout.'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  /** Complete the app-server handshake before account, model, or execution requests. */
  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      clientInfo: { name: 'aiden', title: 'Aiden', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
    return result;
  }

  /** Allow graceful termination, then kill a provider that ignores shutdown after two seconds. */
  private terminate(): void {
    this.process.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (this.process.exitCode === null && this.process.signalCode === null)
        this.process.kill('SIGKILL');
    }, 2000);
    timer.unref();
  }

  /** Stop accepting calls immediately and release all pending timers and listeners. */
  close(): void {
    if (this.closed) return;
    this.fail(new Error('Runtime closed.'));
  }
}
