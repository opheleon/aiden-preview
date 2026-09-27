import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';

import type { SubscriptionState } from '../../contracts/src/api.js';
import { cleanEnvironment } from './environment.js';
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export const claudeSignIn =
  'Sign in to Claude Code with your Claude subscription, then select Check connection. Run: claude auth login --claudeai';

/** Carry an actionable connection state without including provider diagnostics or credentials. */
export class ClaudeConnectionError extends Error {
  /** Bind a sanitized user-facing message to the connection recovery state. */
  constructor(
    public state: SubscriptionState,
    message: string,
  ) {
    super(message);
  }
}

/** Resolve the same executable for status checks and SDK execution. No shell lookup. */
export function claudeBinary(): string {
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates: string[] = [];
  if (process.env.AIDEN_CLAUDE_BINARY) candidates.push(process.env.AIDEN_CLAUDE_BINARY);
  else {
    // Prefer the user's installed CLI: macOS keychain access can differ between
    // that signed executable and the SDK's separately bundled executable.
    if (process.env.HOME) candidates.push(path.join(process.env.HOME, '.local', 'bin', executable));
    candidates.push(
      ...(process.env.PATH ?? '')
        .split(path.delimiter)
        .filter((p) => path.isAbsolute(p))
        .map((p) => path.join(p, executable)),
    );
    const header =
      process.platform === 'linux'
        ? (process.report?.getReport() as { header?: Record<string, unknown> }).header
        : undefined;
    const musl = header && !('glibcVersionRuntime' in header) ? '-musl' : '';
    try {
      candidates.push(
        require.resolve(
          `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl}/${executable}`,
        ),
      );
    } catch {
      /* Optional native dependency may be absent. */
    }
  }
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // A missing or non-executable candidate does not prevent trying the next location.
    }
  }
  throw new ClaudeConnectionError(
    'unavailable',
    'Claude runtime unavailable. Install Claude Code or restore the SDK native dependency, then check connection. AIDEN_CLAUDE_BINARY must be an absolute executable path.',
  );
}

/** Isolate API credentials from subscription sessions while retaining the user-selected subscription profile. */
export function claudeEnvironment(
  home: string,
  auth: 'subscription' | 'apiKey',
  key?: string,
): NodeJS.ProcessEnv {
  const env = cleanEnvironment();
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'aiden/0.1.0';
  // The SDK receives a replacement environment, not process.env plus overrides.
  if (auth === 'apiKey') {
    if (!key)
      throw new Error(
        'Claude requires an Anthropic API key. Add one in Setup or set ANTHROPIC_API_KEY.',
      );
    env.ANTHROPIC_API_KEY = key;
    env.CLAUDE_CONFIG_DIR = path.join(home, 'claude-api');
  } else if (process.env.CLAUDE_CONFIG_DIR) {
    // A user-selected Claude authentication profile remains owned by Claude.
    env.CLAUDE_CONFIG_DIR = path.resolve(process.env.CLAUDE_CONFIG_DIR);
  }
  return env;
}

/** Treat incomplete status output as unknown; only a first-party paid subscription is authenticated. */
export function subscriptionFromStatus(value: unknown): SubscriptionState {
  if (!value || typeof value !== 'object') return 'check_failed';
  const s = value as Record<string, unknown>;
  if (s.loggedIn === false) return 'sign_in_required';
  if (s.loggedIn !== true) return 'check_failed';
  return s.authMethod === 'claude.ai' &&
    s.apiProvider === 'firstParty' &&
    typeof s.subscriptionType === 'string' &&
    !!s.subscriptionType &&
    s.subscriptionType !== 'free'
    ? 'authenticated'
    : 'sign_in_required';
}

/** Confirm the running SDK selected subscription credentials rather than API-key billing. */
export function isSubscriptionAccount(a: AccountInfo): boolean {
  return (
    a.apiProvider === 'firstParty' &&
    !!a.subscriptionType &&
    a.subscriptionType !== 'free' &&
    (!a.apiKeySource || a.apiKeySource === 'none') &&
    (!a.tokenSource || a.tokenSource !== 'none')
  );
}

export const messages: Record<SubscriptionState, string> = {
  authenticated:
    'Claude subscription sign-in detected. Provider limits and usage-credit billing may apply.',
  sign_in_required: claudeSignIn,
  unavailable: 'Claude runtime unavailable. Install Claude Code, then check connection.',
  check_failed:
    'Could not check Claude authentication. Check your connection and Claude installation, then retry.',
};

/** Bound CLI status inspection, return coarse recovery states, and propagate caller cancellation. */
export async function claudeAuthStatus(
  binary: string,
  home: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<SubscriptionState> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await exec(binary, ['--setting-sources', '', 'auth', 'status', '--json'], {
      cwd: home,
      env,
      signal,
      timeout: 10000,
      killSignal: 'SIGKILL',
      maxBuffer: 64000,
    });
    return subscriptionFromStatus(JSON.parse(stdout));
  } catch (error) {
    signal?.throwIfAborted();
    const e = error as NodeJS.ErrnoException & { stdout?: string };
    if (e.code === 'ENOENT') return 'unavailable';
    // Signed-out status exits 1 with structured JSON. Never forward raw output.
    if (String(e.code) === '1' && e.stdout) {
      try {
        return subscriptionFromStatus(JSON.parse(e.stdout));
      } catch {
        // Malformed signed-out output is a failed check, never proof of authentication.
      }
    }
    return 'check_failed';
  }
}
