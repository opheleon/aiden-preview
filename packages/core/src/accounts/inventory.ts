import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RuntimeDiagnostic } from '../../../contracts/src/api.js';
import type { McpConnection } from '../../../contracts/src/integrations.js';
import { notionReady, trackerUrl } from '../../../contracts/src/tracker-connections.js';
import { githubCliEnv } from '../../../tools/src/github-accounts.js';

const run = promisify(execFile);
/** Verified tools change rarely; probing every poll would spawn processes needlessly. */
const cacheMs = 5 * 60 * 1000;

/** A tool's verified state. */
export type ToolState = { installed: boolean; signedIn?: boolean };
/** Usage for one provider and billing mode; unknown utilization is reported as null. */
export type ProviderUsage = {
  provider: 'claude' | 'codex';
  auth: 'subscription' | 'apiKey';
  signedIn: boolean;
  fiveHourUtil: number | null;
  weeklyUtil: number | null;
  resetsAt: string | null;
  /** Actual measurement time, preserved when inventory is cached. */
  readAt?: string | null;
};
/** What this machine can do, verified rather than assumed. */
export type Inventory = {
  tools: Record<'git' | 'gh' | 'claude' | 'codex' | 'playwright', ToolState>;
  connections: Record<'linear' | 'jira' | 'notion', boolean>;
  providers: ProviderUsage[];
};

/** Injectable probes so tests never spawn real tools. */
export type InventoryProbes = {
  diagnostics: () => Promise<RuntimeDiagnostic[]>;
  connections: () => Promise<McpConnection[]>;
  command?: (file: string, args: string[]) => Promise<void>;
  browsersInstalled?: () => boolean;
};

/** Run a CLI read-only with the same PATH and no-prompt settings the GitHub tools use. */
async function command(file: string, args: string[]): Promise<void> {
  await run(file, args, { timeout: 15_000, env: githubCliEnv() });
}

/** Playwright's browser cache: the packaged path, or the default cache for development. */
function browsersInstalled(): boolean {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const fallback =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : path.join(os.homedir(), '.cache', 'ms-playwright');
  return existsSync(configured && configured !== '0' ? configured : fallback);
}

/** Whether a command exists and succeeds; ENOENT means not installed. */
async function probe(
  exec: NonNullable<InventoryProbes['command']>,
  file: string,
  args: string[],
): Promise<ToolState> {
  try {
    await exec(file, args);
    return { installed: true, signedIn: true };
  } catch (error) {
    return (error as { code?: unknown }).code === 'ENOENT'
      ? { installed: false }
      : { installed: true, signedIn: false };
  }
}

/** Map provider diagnostics to tools and to exact provider-plus-billing entries. */
function providerState(diagnostics: RuntimeDiagnostic[]): Pick<Inventory, 'providers'> & {
  claude: ToolState;
  codex: ToolState;
} {
  const providers: ProviderUsage[] = [];
  /** One provider's tool state, recording each billing mode it is signed in with. */
  const tool = (name: 'claude' | 'codex'): ToolState => {
    const found = diagnostics.find((d) => d.provider === name);
    if (!found?.installed) return { installed: false };
    // Plan limits apply only to subscriptions; API-key usage has no plan window to report.
    const unknown = { fiveHourUtil: null, weeklyUtil: null, resetsAt: null };
    if (found.subscription)
      providers.push({
        provider: name,
        auth: 'subscription',
        signedIn: true,
        ...(found.usage ?? unknown),
      });
    if (found.apiKey)
      providers.push({ provider: name, auth: 'apiKey', signedIn: true, ...unknown });
    return { installed: true, signedIn: found.subscription || found.apiKey };
  };
  return { claude: tool('claude'), codex: tool('codex'), providers };
}

/** Which integrations are connected, never their credentials. */
function connectionState(connections: McpConnection[]): Inventory['connections'] {
  const connected = connections.filter((c) => c.status === 'connected');
  return {
    linear: connected.some((c) => c.url === trackerUrl('linear')),
    jira: connected.some((c) => c.url === trackerUrl('jira')),
    notion: connected.some(notionReady),
  };
}

/** Probe tools, connections, and providers; cached for five minutes. */
export class InventoryProbe {
  private cached?: { at: number; value: Inventory };

  /** Bind the probes. */
  constructor(private readonly probes: InventoryProbes) {}

  /** Current inventory, reusing a recent probe unless `fresh` is set. */
  async read(fresh = false, now = Date.now()): Promise<Inventory> {
    if (!fresh && this.cached && now - this.cached.at < cacheMs) return this.cached.value;
    const exec = this.probes.command ?? command;
    const [git, gh, diagnostics, connections] = await Promise.all([
      probe(exec, 'git', ['--version']),
      probe(exec, 'gh', ['auth', 'status']),
      this.probes.diagnostics().catch(() => []),
      this.probes.connections().catch(() => []),
    ]);
    const providers = providerState(diagnostics);
    const value: Inventory = {
      tools: {
        git: { installed: git.installed },
        gh,
        claude: providers.claude,
        codex: providers.codex,
        playwright: { installed: (this.probes.browsersInstalled ?? browsersInstalled)() },
      },
      connections: connectionState(connections),
      providers: providers.providers,
    };
    this.cached = { at: now, value };
    return value;
  }
}

/** Machine state from Electron main (idle time, power) plus what Node can read here. */
export function machineState(input: { idleSeconds: number; onBattery: boolean }): {
  cores: number;
  loadAvg1: number;
  freeMemMb: number;
  totalMemMb: number;
  idleSeconds: number;
  onBattery: boolean;
} {
  return {
    cores: os.cpus().length,
    loadAvg1: Math.round(os.loadavg()[0]! * 100) / 100,
    freeMemMb: Math.round(os.freemem() / 1048576),
    totalMemMb: Math.round(os.totalmem() / 1048576),
    idleSeconds: Math.max(0, Math.round(input.idleSeconds)),
    onBattery: input.onBattery,
  };
}
