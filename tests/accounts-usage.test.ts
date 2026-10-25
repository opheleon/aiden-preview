import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { AccountInfo, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

import { InventoryProbe } from '../packages/core/src/accounts/inventory.js';
import {
  type ClaudeDependencies,
  claudeUsage,
  recordClaudeRateLimit,
  resetClaudeUsage,
} from '../packages/runtimes/src/claude.js';
import { Runtimes } from '../packages/runtimes/src/index.js';
import { codexPlanUsage } from '../packages/runtimes/src/plan-usage.js';

const subscription: AccountInfo = { apiProvider: 'firstParty', subscriptionType: 'max' };
const unknown = { fiveHourUtil: null, weeklyUtil: null, resetsAt: null };
const sdkUsage = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 19, resets_at: '2026-10-21T23:00:00.000Z' },
    seven_day: { utilization: 27, resets_at: '2026-10-25T18:00:00.000Z' },
  },
};

/** A fake SDK whose usage answer is configurable; it records opened streams and sent prompts. */
function fakeSdk(settings: { account?: AccountInfo; usage?: () => Promise<unknown> } = {}) {
  const seen = { opened: 0, closed: 0, prompts: 0, skipBehaviors: undefined as unknown };
  const deps: ClaudeDependencies = {
    binary: () => '/fixture/claude',
    status: () => Promise.resolve('authenticated'),
    query: (p) => {
      seen.opened++;
      void (async () => {
        for await (const input of p.prompt as AsyncIterable<unknown>) if (input) seen.prompts++;
      })();
      return {
        accountInfo: () => Promise.resolve(settings.account ?? subscription),
        ...(settings.usage === null
          ? {}
          : {
              usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (opts?: {
                skipBehaviors?: boolean;
              }) => {
                seen.skipBehaviors = opts?.skipBehaviors;
                return (settings.usage ?? (() => Promise.resolve(sdkUsage)))();
              },
            }),
        close: () => {
          seen.closed++;
        },
      } as unknown as ReturnType<ClaudeDependencies['query']>;
    },
  };
  return { deps, seen };
}

void test('Claude plan usage is read without a prompt, reported as fractions, and cached', async () => {
  resetClaudeUsage();
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-usage-'));
  const { deps, seen } = fakeSdk();
  assert.deepEqual(await claudeUsage(home, deps, 0), {
    fiveHourUtil: 0.19,
    weeklyUtil: 0.27,
    resetsAt: '2026-10-25T18:00:00.000Z',
    readAt: new Date(0).toISOString(),
  });
  assert.deepEqual(seen, { opened: 1, closed: 1, prompts: 0, skipBehaviors: true });
  assert.equal(
    (await claudeUsage(home, deps, 60_000)).readAt,
    new Date(0).toISOString(),
    'cached measurements keep their original timestamp',
  );
  assert.equal(seen.opened, 1, 'reused within five minutes');

  // A run's rate-limit event refreshes the cached windows; utilization there is a fraction.
  recordClaudeRateLimit({
    status: 'allowed',
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.8, resetsAt: 1792651800 },
      seven_day: { utilization: 0.3, resetsAt: 1792792800 },
    },
  } as SDKRateLimitInfo);
  assert.deepEqual(await claudeUsage(home, deps, 120_000), {
    fiveHourUtil: 0.8,
    weeklyUtil: 0.3,
    resetsAt: new Date(1792651800 * 1000).toISOString(),
    readAt: new Date(0).toISOString(),
  });
  recordClaudeRateLimit({
    status: 'allowed',
    rateLimitType: 'seven_day',
    utilization: 0.5,
  });
  assert.equal((await claudeUsage(home, deps, 120_000)).weeklyUtil, 0.5);
  await claudeUsage(home, deps, 6 * 60_000);
  assert.equal(seen.opened, 2, 'read again after five minutes');
});

void test('Claude plan usage is unknown when it cannot be read, never an error', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-usage-'));
  const cases = [
    fakeSdk({ usage: () => Promise.reject(new Error('unsupported control request')) }),
    fakeSdk({ usage: null as never }),
    fakeSdk({ usage: () => Promise.resolve({ rate_limits_available: false, rate_limits: null }) }),
    fakeSdk({ usage: () => Promise.resolve({ unexpected: true }) }),
    fakeSdk({ account: { apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' } }),
  ];
  for (const { deps, seen } of cases) {
    resetClaudeUsage();
    assert.deepEqual(await claudeUsage(home, deps, 0), {
      ...unknown,
      readAt: new Date(0).toISOString(),
    });
    assert.equal(seen.closed, 1);
    assert.equal(seen.prompts, 0);
  }
  resetClaudeUsage();
  const missing = fakeSdk();
  missing.deps.binary = () => {
    throw new Error('Claude runtime unavailable.');
  };
  assert.deepEqual(await claudeUsage(home, missing.deps, 0), {
    ...unknown,
    readAt: new Date(0).toISOString(),
  });
  resetClaudeUsage();
});

void test('Codex rate limits map windows by length and treat anything malformed as unknown', () => {
  assert.deepEqual(
    codexPlanUsage({
      rateLimits: {
        primary: { usedPercent: 11, windowDurationMins: 10080, resetsAt: 1793113821 },
        secondary: null,
      },
    }),
    { fiveHourUtil: null, weeklyUtil: 0.11, resetsAt: new Date(1793113821 * 1000).toISOString() },
  );
  assert.deepEqual(
    codexPlanUsage({
      rateLimits: {
        primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: 1792651800 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1793113821 },
      },
    }),
    { fiveHourUtil: 0.64, weeklyUtil: 0.4, resetsAt: new Date(1792651800 * 1000).toISOString() },
  );
  assert.deepEqual(codexPlanUsage({ rateLimits: null }), unknown);
  assert.deepEqual(codexPlanUsage(undefined), unknown);
});

/** Fake Codex and Claude binaries: Codex answers rate limits as `mode` says, Claude is signed out. */
async function fakeProviders(mode: 'ok' | 'error'): Promise<{ home: string; restore: () => void }> {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-usage-providers-'));
  const codex = path.join(home, 'codex');
  const claude = path.join(home, 'claude');
  await writeFile(
    codex,
    `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('codex-cli 0.0.0'); process.exit(0); }
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  if (m.method === 'account/rateLimits/read' && ${JSON.stringify(mode)} === 'error')
    return process.stdout.write(JSON.stringify({ id: m.id, error: { message: 'unknown method' } }) + '\\n');
  const result = m.method === 'account/read' ? { account: { type: 'chatgpt' } }
    : m.method === 'account/rateLimits/read'
      ? { rateLimits: { primary: { usedPercent: 11, windowDurationMins: 10080, resetsAt: 1793113821 }, secondary: null } }
      : {};
  process.stdout.write(JSON.stringify({ id: m.id, result }) + '\\n');
});\n`,
    { mode: 0o755 },
  );
  await writeFile(
    claude,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ loggedIn: false })); process.exit(1);\n`,
    { mode: 0o755 },
  );
  const prior = { codex: process.env.AIDEN_CODEX_BINARY, claude: process.env.AIDEN_CLAUDE_BINARY };
  process.env.AIDEN_CODEX_BINARY = codex;
  process.env.AIDEN_CLAUDE_BINARY = claude;
  return {
    home,
    restore: () => {
      for (const [key, value] of [
        ['AIDEN_CODEX_BINARY', prior.codex],
        ['AIDEN_CLAUDE_BINARY', prior.claude],
      ] as const)
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    },
  };
}

void test('Teams polls carry Codex usage from the app-server; a failed read reports null', async () => {
  for (const mode of ['ok', 'error'] as const) {
    const { home, restore } = await fakeProviders(mode);
    const runtimes = new Runtimes(home);
    try {
      const plain = await runtimes.diagnostics();
      assert.equal(plain[0]!.usage, undefined, 'Setup checks never read usage');
      const inventory = await new InventoryProbe({
        diagnostics: () => runtimes.diagnostics({ usage: true }),
        connections: () => Promise.resolve([]),
        command: () => Promise.resolve(),
        browsersInstalled: () => true,
      }).read();
      if (mode === 'ok')
        assert.ok(
          Number.isFinite(Date.parse(inventory.providers[0]?.readAt ?? '')),
          'provider measurement has a real timestamp',
        );
      const reported = inventory.providers.map((provider) => {
        const usage = { ...provider };
        delete usage.readAt;
        return usage;
      });
      assert.deepEqual(reported, [
        {
          provider: 'codex',
          auth: 'subscription',
          signedIn: true,
          ...(mode === 'ok'
            ? { fiveHourUtil: null, weeklyUtil: 0.11, resetsAt: '2026-10-27T15:10:21.000Z' }
            : unknown),
        },
      ]);
    } finally {
      runtimes.dispose();
      restore();
    }
  }
});
