import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import type { RuntimeDiagnostic, RuntimeModel } from '../../contracts/src/api.js';
import type { RuntimeConfig } from '../../contracts/src/index.js';
import { claudeDiagnostics, claudeModels, runClaude } from './claude.js';
import { loadCodexModels, runCodex } from './codex.js';
import { accountSchema, loginSchema } from './codex-schemas.js';
import { cleanEnvironment } from './environment.js';
import { RpcClient } from './rpc.js';
import type { AgentRuntime, RuntimeRequest, RuntimeResult } from './types.js';

export { ArtifactFormatError, cleanEnvironment, parseJson, publicError } from './environment.js';
export { RpcClient } from './rpc.js';
export type { AgentRuntime, RuntimeRequest, RuntimeResult } from './types.js';
const exec = promisify(execFile);
const claudeVersion = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(
      readFileSync(
        path.join(
          path.dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')),
          'package.json',
        ),
        'utf8',
      ),
    ),
  ).version;
/** Manage in-memory API keys, login lifetime, and isolated provider sessions. */
export class Runtimes implements AgentRuntime {
  private keys = new Map<string, string>();
  private login: RpcClient | undefined;
  private loginTimer: ReturnType<typeof setTimeout> | undefined;
  /** Preserve the supplied Aiden home; provider profiles remain separated by auth mode. */
  constructor(public home: string) {}
  /** Store an explicitly supplied key in memory only; blank keys never erase a working session. */
  setKey(provider: string, key: string): void {
    if (!['codex', 'claude'].includes(provider)) throw new Error('Unknown provider.');
    if (!key.trim()) throw new Error('API key is empty.');
    this.keys.set(provider, key.trim());
  }
  /** Prefer the session key, falling back only to that provider’s explicitly named environment key. */
  key(provider: string): string | undefined {
    return (
      this.keys.get(provider) ||
      process.env[provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']
    );
  }
  /** Initialize a fresh Codex process and close it on cancellation or initialization failure. */
  private async client(
    auth: 'subscription' | 'apiKey',
    overrides: string[] = [],
    signal?: AbortSignal,
  ): Promise<RpcClient> {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const env = cleanEnvironment();
    if (auth === 'apiKey') {
      env.CODEX_HOME = path.join(this.home, 'codex-api');
      await mkdir(env.CODEX_HOME, { recursive: true, mode: 0o700 });
    }
    signal?.throwIfAborted();
    const c = new RpcClient(env, this.home, overrides);
    /** Interrupt initialization when the caller cancels. */
    const stop = () => c.close();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await c.initialize();
      signal?.throwIfAborted();
      return c;
    } catch (e) {
      c.close();
      throw e;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }
  /** Inspect provider availability and account state without sending prompts or running tools. */
  async diagnostics(): Promise<RuntimeDiagnostic[]> {
    const codex: RuntimeDiagnostic = {
      provider: 'codex',
      installed: false,
      ready: false,
      subscription: false,
      apiKey: !!this.key('codex'),
    };
    try {
      const v = await exec(process.env.AIDEN_CODEX_BINARY || 'codex', ['--version'], {
        timeout: 10000,
        env: cleanEnvironment(),
      });
      codex.installed = true;
      codex.version = v.stdout.trim();
      const c = await this.client('subscription');
      try {
        const a = accountSchema.parse(await c.request('account/read', { refreshToken: false }));
        codex.subscription = a.account?.type === 'chatgpt';
        codex.ready = codex.subscription || codex.apiKey;
        if (!codex.subscription) codex.message = 'Sign in with Codex, then check connection.';
      } finally {
        c.close();
      }
    } catch {
      codex.message = codex.installed
        ? 'Codex is installed but its connection check failed. Check your connection, then retry.'
        : 'Install the Codex CLI, then restart Aiden and check connection. The Codex desktop app alone is not sufficient.';
    }
    return [codex, await claudeDiagnostics(this.home, this.key('claude'), claudeVersion)];
  }

  /** Start subscription login and expire its process after ten minutes; never change billing mode. */
  async loginCodex(): Promise<{ authUrl?: string | undefined }> {
    this.login?.close();
    this.login = await this.client('subscription');
    const c = this.login;
    c.listeners.add((m) => {
      if (m.method === 'account/login/completed' || m.method === 'aiden/exit') {
        clearTimeout(this.loginTimer);
        c.close();
        if (this.login === c) this.login = undefined;
      }
    });
    this.loginTimer = setTimeout(
      () => {
        c.close();
        if (this.login === c) this.login = undefined;
      },
      10 * 60 * 1000,
    );
    this.loginTimer.unref();
    try {
      return loginSchema.parse(await c.request('account/login/start', { type: 'chatgpt' }));
    } catch (error) {
      c.close();
      throw error;
    }
  }
  /** Load the selected account’s models with bounded pagination and no user prompt. */
  async models(config: RuntimeConfig): Promise<RuntimeModel[]> {
    if (config.provider === 'claude') return claudeModels(this.home, config, this.key('claude'));
    if (config.auth === 'apiKey' && !this.key('codex'))
      throw new Error('Add an OpenAI API key before loading API models.');
    const signal = AbortSignal.timeout(20000);
    const client = await this.client(config.auth, [], signal);
    /** End discovery immediately when its deadline expires. */
    const stop = () => client.close();
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      if (config.auth === 'apiKey')
        await client.request('account/login/start', { type: 'apiKey', apiKey: this.key('codex') });
      const account = accountSchema.parse(
        await client.request('account/read', { refreshToken: false }),
      );
      if (account.account?.type !== (config.auth === 'subscription' ? 'chatgpt' : 'apiKey'))
        throw new Error('Sign in with the selected authentication method before loading models.');
      return await loadCodexModels(client);
    } finally {
      signal.removeEventListener('abort', stop);
      client.close();
    }
  }
  /** Close any login process and discard in-memory provider keys on shutdown. */
  dispose(): void {
    clearTimeout(this.loginTimer);
    this.login?.close();
    this.keys.clear();
  }
  /** Dispatch one turn to the selected provider; cancellation is checked before any provider work. */
  async run(r: RuntimeRequest): Promise<RuntimeResult> {
    r.signal.throwIfAborted();
    if (r.config.provider === 'claude') return this.claude(r);
    return this.codex(r);
  }
  /** Use the Claude adapter with the session key and pinned SDK identity. */
  private async claude(r: RuntimeRequest): Promise<RuntimeResult> {
    return runClaude(r, this.home, this.key('claude'), claudeVersion);
  }
  /** Execute Codex with a fresh isolated client and only the approved Aiden tools. */
  private async codex(r: RuntimeRequest): Promise<RuntimeResult> {
    return runCodex(
      r,
      (overrides) => this.client(r.config.auth, overrides, r.signal),
      this.key('codex'),
    );
  }
}
