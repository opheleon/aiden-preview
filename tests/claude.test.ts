import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AccountInfo, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { RunManifest } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { json, Store } from '../packages/core/src/storage.js';
import {
  claudeAuthStatus,
  ClaudeConnectionError,
  type ClaudeDependencies,
  claudeDiagnostics,
  claudeEnvironment,
  runClaude,
} from '../packages/runtimes/src/claude.js';
import type { RuntimeRequest } from '../packages/runtimes/src/index.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const account: AccountInfo = { apiProvider: 'firstParty', subscriptionType: 'Claude Max' };
const success = {
  type: 'result',
  subtype: 'success',
  structured_output: { fixture: true },
} as SDKMessage;
function sdkFixture(
  settings: {
    account?: AccountInfo;
    messages?: SDKMessage[];
    waitForAccount?: boolean;
    waitForResult?: boolean;
  } = {},
) {
  let opened = 0,
    closed = 0,
    submitted = 0,
    params: Parameters<ClaudeDependencies['query']>[0];
  const deps: ClaudeDependencies = {
    binary: () => '/fixture/claude',
    status: () => Promise.resolve('authenticated'),
    query: (p) => {
      opened++;
      params = p;
      const aborted = () =>
        new Promise<never>((_, reject) => {
          p.options!.abortController!.signal.addEventListener(
            'abort',
            () => reject(new Error('Aborted')),
            { once: true },
          );
        });
      const reading = (async () => {
        for await (const input of p.prompt as AsyncIterable<unknown>) {
          assert.ok(input);
          submitted++;
        }
      })();
      return {
        accountInfo: async () => {
          assert.equal(submitted, 0, 'No assessment input before account validation');
          if (settings.waitForAccount) await aborted();
          return settings.account ?? account;
        },
        close: () => {
          closed++;
        },
        async *[Symbol.asyncIterator]() {
          await reading;
          if (settings.waitForResult) await aborted();
          yield* settings.messages ?? [success];
        },
      } as ReturnType<ClaudeDependencies['query']>;
    },
  };
  return { deps, state: () => ({ opened, closed, submitted, params }) };
}
async function request(auth: 'subscription' | 'apiKey' = 'subscription') {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-claude-'));
  const controller = new AbortController();
  const r: RuntimeRequest = {
    config: { provider: 'claude', auth },
    prompt: 'Synthetic fixture assessment',
    schema: {},
    cwd: home,
    tools: { url: 'http://127.0.0.1:1/mcp', token: 'fixture' },
    signal: controller.signal,
    progress: () => {},
  };
  return { r, home, controller };
}

void test('Claude structured auth status distinguishes subscription, signed-out, Console, malformed and missing runtime', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-auth-status-'));
  const binary = path.join(home, 'claude-fixture');
  await writeFile(
    binary,
    `#!/usr/bin/env node
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--setting-sources','','auth','status','--json'])) process.exit(9);
process.stdout.write(process.env.TEST_STATUS);process.exit(Number(process.env.TEST_EXIT||0));`,
    { mode: 0o755 },
  );
  for (const [value, exit, expected] of [
    [
      {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'max',
      },
      0,
      'authenticated',
    ],
    [{ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, 1, 'sign_in_required'],
    [{ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }, 0, 'sign_in_required'],
    [
      { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock', subscriptionType: 'max' },
      0,
      'sign_in_required',
    ],
    ['not JSON', 1, 'check_failed'],
  ] as const) {
    assert.equal(
      await claudeAuthStatus(binary, home, {
        PATH: process.env.PATH,
        TEST_STATUS: typeof value === 'string' ? value : JSON.stringify(value),
        TEST_EXIT: String(exit),
      }),
      expected,
    );
  }
  assert.equal(await claudeAuthStatus(path.join(home, 'missing'), home, {}), 'unavailable');
});

void test('Claude diagnostics expose all subscription states without account identifiers or raw provider errors', async () => {
  const { home } = await request();
  for (const state of [
    'authenticated',
    'sign_in_required',
    'unavailable',
    'check_failed',
  ] as const) {
    const fake = sdkFixture();
    fake.deps.status = () => Promise.resolve(state);
    const d = await claudeDiagnostics(home, undefined, 'fixture', fake.deps);
    assert.equal(d.subscriptionState, state);
    assert.equal(d.subscription, state === 'authenticated');
    assert.equal(d.ready, state === 'authenticated');
    assert.equal(fake.state().opened, 0, 'Diagnostics must not send model prompts');
  }
  const fake = sdkFixture();
  fake.deps.binary = () => {
    throw new ClaudeConnectionError('unavailable', 'secret-provider-output');
  };
  const d = await claudeDiagnostics(home, 'fixture-key', 'fixture', fake.deps);
  assert.equal(d.installed, false);
  assert.equal(d.ready, false);
  assert.ok(!JSON.stringify(d).includes('secret-provider-output'));
});

void test('cancelling a hung Claude authentication check terminates the subprocess promptly', async () => {
  const { home, controller } = await request();
  const binary = path.join(home, 'hung-claude');
  await writeFile(binary, '#!/usr/bin/env node\nsetInterval(()=>{},1000);\n', { mode: 0o755 });
  const started = Date.now();
  const pending = claudeAuthStatus(binary, home, { PATH: process.env.PATH }, controller.signal);
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(pending);
    assert.ok(Date.now() - started < 1500);
  } finally {
    clearTimeout(timer);
  }
});

void test('a custom Claude profile is reused only for subscription authentication', async () => {
  const { home } = await request();
  const before = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'existing-profile');
    assert.equal(
      claudeEnvironment(home, 'subscription').CLAUDE_CONFIG_DIR,
      process.env.CLAUDE_CONFIG_DIR,
    );
    assert.equal(
      claudeEnvironment(home, 'apiKey', 'fixture-key').CLAUDE_CONFIG_DIR,
      path.join(home, 'claude-api'),
    );
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

void test('subscription authentication excludes inherited credentials and provider configuration; API auth stays isolated', async () => {
  const { r, home } = await request();
  const vars = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'ANTHROPIC_BASE_URL',
    'AWS_SECRET_ACCESS_KEY',
  ];
  const before = Object.fromEntries(vars.map((k) => [k, process.env[k]]));
  try {
    for (const k of vars) process.env[k] = 'fixture-secret';
    const fake = sdkFixture();
    assert.deepEqual((await runClaude(r, home, 'saved-api-key', 'fixture', fake.deps)).value, {
      fixture: true,
    });
    const s = fake.state();
    assert.equal(s.submitted, 1);
    assert.equal(s.closed, 1);
    for (const k of vars) assert.equal(s.params.options!.env![k], undefined);
    assert.deepEqual(s.params.options!.tools, []);
    assert.deepEqual(s.params.options!.settingSources, []);
    assert.deepEqual(s.params.options!.plugins, []);
    assert.equal(s.params.options!.strictMcpConfig, true);
    assert.deepEqual(Object.keys(s.params.options!.mcpServers!), ['aiden']);
    const api = claudeEnvironment(home, 'apiKey', 'explicit-key');
    assert.equal(api.ANTHROPIC_API_KEY, 'explicit-key');
    assert.equal(api.CLAUDE_CONFIG_DIR, path.join(home, 'claude-api'));
    assert.equal(api.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  } finally {
    for (const k of vars) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

void test('signed-out and offline checks never start the SDK or fall back to an available API key', async () => {
  const { r, home } = await request();
  for (const state of ['sign_in_required', 'check_failed', 'unavailable'] as const) {
    const fake = sdkFixture();
    fake.deps.status = () => Promise.resolve(state);
    await assert.rejects(
      runClaude(r, home, 'available-api-key', 'fixture', fake.deps),
      (e) => e instanceof ClaudeConnectionError && e.state === state,
    );
    assert.equal(fake.state().opened, 0);
  }
});

void test('SDK account disagreement blocks the prompt even after a successful CLI status check', async () => {
  const { r, home } = await request();
  for (const info of [
    {},
    { ...account, apiKeySource: 'ANTHROPIC_API_KEY' },
    { ...account, apiProvider: 'bedrock' },
  ] as AccountInfo[]) {
    const fake = sdkFixture({ account: info });
    await assert.rejects(
      runClaude(r, home, 'fixture-key', 'fixture', fake.deps),
      /Sign in to Claude Code/,
    );
    assert.equal(fake.state().submitted, 0);
    assert.equal(fake.state().closed, 1);
  }
});

void test('explicit API-key runs use the SDK without a subscription and reject subscription fallback', async () => {
  const { r, home } = await request('apiKey');
  const fake = sdkFixture({
    account: { apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' },
  });
  fake.deps.status = () => Promise.reject(new Error('API auth must not check subscription'));
  await runClaude(r, home, 'explicit-key', 'fixture', fake.deps);
  assert.equal(fake.state().params.options!.env!.ANTHROPIC_API_KEY, 'explicit-key');
  const wrong = sdkFixture();
  await assert.rejects(runClaude(r, home, 'explicit-key', 'fixture', wrong.deps), /did not select/);
  assert.equal(wrong.state().submitted, 0);
});

void test('expired authentication, usage limits, billing and network errors have distinct recovery guidance', async () => {
  const { r, home } = await request();
  for (const [error, expected] of [
    ['authentication_failed', /claude auth login --claudeai/],
    ['rate_limit', /usage limit/],
    ['billing_error', /billing error/],
    ['server_error', /connection and provider/],
  ] as const) {
    const fake = sdkFixture({ messages: [{ type: 'assistant', error } as SDKMessage] });
    await assert.rejects(runClaude(r, home, undefined, 'fixture', fake.deps), expected);
    assert.equal(fake.state().closed, 1);
  }
});

void test('Claude closes on forbidden tools and cancellation during account initialization or generation', async () => {
  const { r, home } = await request();
  const forbidden = sdkFixture({
    messages: [
      { type: 'system', subtype: 'init', tools: ['Bash'], model: 'fixture' } as SDKMessage,
    ],
  });
  await assert.rejects(
    runClaude(r, home, undefined, 'fixture', forbidden.deps),
    /unexpected tools/,
  );
  assert.equal(forbidden.state().closed, 1);
  for (const stage of ['waitForAccount', 'waitForResult'] as const) {
    const { r, home, controller } = await request();
    const fake = sdkFixture({ [stage]: true });
    const running = runClaude(r, home, undefined, 'fixture', fake.deps);
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      await assert.rejects(running);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(fake.state().closed, 1);
    if (stage === 'waitForAccount') assert.equal(fake.state().submitted, 0);
  }
});

void test('Claude auth failure and cancelled generation preserve the previous accepted report', async () => {
  const f = await fixture();
  f.project.runtime = { provider: 'claude', auth: 'subscription' };
  const store = new Store(path.join(f.root, 'data'));
  const fixtureRuntime = new FixtureRuntime(f);
  let next: ClaudeDependencies | undefined;
  const engine = new Engine(store, {
    run: (r) =>
      next ? runClaude(r, store.root, undefined, 'fixture', next) : fixtureRuntime.run(r),
  });
  try {
    const p = await engine.prepare(f.project);
    await engine.wait(p.runId);
    await engine.approve(f.project.id, p.runId, f.product);
    const good = await engine.report(f.project.id);
    await engine.wait(good.runId);
    const fake = sdkFixture();
    fake.deps.status = () => Promise.resolve('sign_in_required');
    next = fake.deps;
    const bad = await engine.report(f.project.id);
    await engine.wait(bad.runId);
    const manifest = await json<RunManifest>(
      path.join(store.run(f.project.id, bad.runId), 'manifest.json'),
    );
    assert.equal(manifest.status, 'failed');
    assert.match(manifest.error!, /Sign in/);
    assert.equal((await engine.getReport(f.project.id)).id, good.runId);
    next = sdkFixture({ waitForResult: true }).deps;
    const cancelled = await engine.report(f.project.id);
    engine.cancel(cancelled.runId);
    await engine.wait(cancelled.runId);
    assert.equal((await engine.getReport(f.project.id)).id, good.runId);
    assert.equal(
      (
        await json<RunManifest>(
          path.join(store.run(f.project.id, cancelled.runId), 'manifest.json'),
        )
      ).status,
      'cancelled',
    );
  } finally {
    await engine.dispose();
  }
});

void test('Claude execution passes the selected model and effort without changing authentication', async () => {
  const { r, home } = await request();
  r.config.model = 'fixture-opus';
  r.config.effort = 'xhigh';
  const fake = sdkFixture();
  await runClaude(r, home, undefined, 'fixture', fake.deps);
  assert.equal(fake.state().params.options?.model, 'fixture-opus');
  assert.equal(fake.state().params.options?.effort, 'xhigh');
  assert.equal(fake.state().params.options?.env?.ANTHROPIC_API_KEY, undefined);
});

void test('external coding dispatch uses Claude Code tools and its permission mode with the selected model and effort', async () => {
  const f = await request();
  const sdk = sdkFixture({
    messages: [
      {
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-5-5',
        tools: ['Read', 'Edit', 'Bash'],
      } as SDKMessage,
      success,
    ],
  });
  f.r.coding = { sessionId: '00000000-0000-4000-8000-000000000001' };
  f.r.config.model = 'opus';
  f.r.config.effort = 'high';
  const result = await runClaude(f.r, f.home, undefined, 'fixture', sdk.deps);
  const options = sdk.state().params.options!;
  assert.deepEqual(options.tools, { type: 'preset', preset: 'claude_code' });
  assert.equal(options.permissionMode, 'auto');
  assert.equal(options.effort, 'high');
  assert.equal(options.model, 'opus');
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.GIT_CONFIG_VALUE_0, '/dev/null');
  assert.equal(result.model, 'claude-opus-5-5');
  assert.equal(sdk.state().submitted, 1);
});
