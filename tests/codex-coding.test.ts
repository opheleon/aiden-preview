import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ExecutionActivity } from '../packages/contracts/src/accounts-execution.js';
import { codexActivity, codexStep, writableRoots } from '../packages/runtimes/src/codex-coding.js';
import { Runtimes } from '../packages/runtimes/src/index.js';
import type { RuntimeRequest } from '../packages/runtimes/src/types.js';

/** A clone with one commit and a job worktree beside it, like a team build prepares. */
async function repository(root: string): Promise<{ clone: string; worktree: string }> {
  const clone = path.join(root, 'clone');
  const worktree = path.join(root, 'worktree');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', ...args], {
      cwd,
    });
  execFileSync('git', ['init', '-q', clone]);
  await writeFile(path.join(clone, 'README.md'), 'fixture\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-qm', 'start');
  git(clone, 'worktree', 'add', '-q', '-b', 'aiden/job-1', worktree);
  return { clone: await realpath(clone), worktree: await realpath(worktree) };
}

// A local protocol substitute, never a provider connection or live model result.
async function codingFixture(mode = 'success') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'aiden-codex-coding-')));
  const binary = path.join(root, 'codex');
  const calls = path.join(root, 'calls.jsonl');
  const launch = path.join(root, 'launch.json');
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const mode = ${JSON.stringify(mode)};
if (process.argv.includes('--version')) { console.log('synthetic-codex-1'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(launch)}, JSON.stringify({ argv: process.argv.slice(2), hooks: process.env.GIT_CONFIG_VALUE_0, npmCache: process.env.npm_config_cache }));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const item = (method, item) => send({ method, params: { threadId: 'thread', turnId: 'turn', item } });
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(m) + '\\n');
  let result = {};
  if (m.method === 'account/read') result = { account: { type: 'chatgpt' } };
  if (m.method === 'model/list') result = { data: [{ model: 'synthetic-model', isDefault: true }], nextCursor: null };
  if (m.method === 'config/read') result = { config: { mcp_servers: { inherited: { command: 'never-run' } } } };
  if (m.method === 'thread/start') result = { thread: { id: 'thread' } };
  if (m.method === 'mcpServerStatus/list') result = { data: mode === 'foreign-tools'
    ? [{ name: 'inherited', tools: { shell: {} } }]
    : [{ name: 'aiden_status', tools: { report_status: {} } }], nextCursor: null };
  send({ id: m.id, result });
  if (m.method === 'turn/start') {
    const command = { type: 'commandExecution', id: 'c1', command: "/bin/zsh -lc 'pnpm test'" };
    item('item/started', command);
    item('item/completed', command);
    const patch = { type: 'fileChange', id: 'f1', changes: [{ path: 'src/app.tsx', kind: { type: 'update' }, diff: '' }] };
    item('item/started', patch);
    item('item/completed', patch);
    const status = { type: 'mcpToolCall', id: 's1', server: 'aiden_status', tool: 'report_status' };
    item('item/started', status);
    item('item/completed', status);
    item('item/completed', { type: 'agentMessage', id: 'a1', text: '{"outcome":"ready"}' });
    send({ method: 'turn/completed', params: { threadId: 'thread', turn: { status: 'completed' } } });
  }
});
`,
    { mode: 0o755 },
  );
  const previous = process.env.AIDEN_CODEX_BINARY;
  process.env.AIDEN_CODEX_BINARY = binary;
  const runtime = new Runtimes(path.join(root, 'providers'));
  const repo = await repository(root);
  const steps: string[] = [];
  const activity: ExecutionActivity[] = [];
  const request: RuntimeRequest = {
    coding: { sessionId: 'session-1' },
    config: { provider: 'codex', auth: 'subscription' },
    cwd: repo.worktree,
    tools: { url: 'http://127.0.0.1:1/mcp', token: 'synthetic-only' },
    prompt: 'Synthetic fixture only.',
    schema: { type: 'object' },
    signal: AbortSignal.timeout(10_000),
    progress: (line) => steps.push(line),
    activity: (event) => activity.push(event),
  };
  return {
    ...repo,
    runtime,
    request,
    steps,
    activity,
    calls: async () =>
      (await readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> }),
    launch: async () =>
      JSON.parse(await readFile(launch, 'utf8')) as {
        argv: string[];
        hooks: string;
        npmCache: string;
      },
    close: async () => {
      runtime.dispose();
      if (previous === undefined) delete process.env.AIDEN_CODEX_BINARY;
      else process.env.AIDEN_CODEX_BINARY = previous;
      await rm(root, { recursive: true, force: true });
    },
  };
}

void test('Codex codes in the job worktree with its own tools, write access to only the job, and no approvals', async () => {
  const fixture = await codingFixture();
  try {
    const result = await fixture.runtime.run(fixture.request);
    assert.deepEqual(result, {
      value: { outcome: 'ready' },
      model: 'synthetic-model',
      version: 'synthetic-codex-1',
    });
    const calls = await fixture.calls();
    const thread = calls.find((call) => call.method === 'thread/start')!.params;
    assert.equal(thread.approvalPolicy, 'never');
    assert.match(String(thread.permissions), /^aiden-coding-/);
    const config = thread.config as {
      features: Record<string, boolean>;
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    // Codex keeps its own shell and file editing; inherited servers and plugins stay off.
    assert.equal(config.features.shell_tool, undefined);
    assert.equal(config.features.plugins, false);
    assert.deepEqual(config.mcp_servers.inherited, { enabled: false });
    assert.deepEqual(config.mcp_servers.aiden_status!.http_headers, {
      Authorization: 'Bearer synthetic-only',
    });
    assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1);
    const launch = await fixture.launch();
    const filesystem = launch.argv.find((arg) => arg.includes('.filesystem='))!;
    assert.match(filesystem, /":root"="read"/);
    assert.ok(filesystem.includes(`${JSON.stringify(fixture.worktree)}="write"`));
    // Commits in a worktree land in the clone's Git folder, so that is writable too.
    assert.ok(filesystem.includes(`${JSON.stringify(path.join(fixture.clone, '.git'))}="write"`));
    assert.ok(!filesystem.includes(`${JSON.stringify(fixture.clone)}="write"`));
    assert.ok(launch.argv.some((arg) => /\.network\.enabled=true$/.test(arg)));
    assert.equal(launch.hooks, '/dev/null');
    assert.match(launch.npmCache, /aiden-coding-cache/);
    assert.deepEqual(fixture.steps, ['Running tests', 'Editing app.tsx']);
    // Status reports never count as activity; the watchdog sees each tool start and end.
    assert.deepEqual(fixture.activity, [
      { type: 'tool-start', id: 'c1' },
      { type: 'tool-end', id: 'c1' },
      { type: 'tool-start', id: 'f1' },
      { type: 'tool-end', id: 'f1' },
      { type: 'output' },
    ]);
  } finally {
    await fixture.close();
  }
});

void test('Codex coding stops before the prompt when another MCP server exposes tools', async () => {
  const fixture = await codingFixture('foreign-tools');
  try {
    await assert.rejects(fixture.runtime.run(fixture.request), /Unexpected MCP tools/);
    assert.equal((await fixture.calls()).filter((call) => call.method === 'turn/start').length, 0);
  } finally {
    await fixture.close();
  }
});

void test('Codex items read as the same plain steps Claude Code shows', () => {
  const item = (fields: Record<string, unknown>) => ({ type: 'x', id: 'i', ...fields });
  assert.equal(
    codexStep(item({ type: 'commandExecution', command: 'bash -lc "python3 -m pytest -q"' })),
    'Running tests',
  );
  assert.equal(
    codexStep(item({ type: 'commandExecution', command: 'git commit -m "Add help"' })),
    'Committing the change',
  );
  assert.equal(
    codexStep(item({ type: 'fileChange', changes: [{ path: 'a.ts' }, { path: 'b.ts' }] })),
    'Editing files',
  );
  assert.equal(codexStep(item({ type: 'reasoning' })), undefined);
  assert.equal(
    codexStep(item({ type: 'mcpToolCall', server: 'aiden_status', tool: 'report_status' })),
    undefined,
  );
  assert.deepEqual(codexActivity('item/completed', item({ type: 'reasoning' })), [
    { type: 'output' },
  ]);
  assert.deepEqual(codexActivity('item/started', item({ type: 'agentMessage' })), []);
});

void test('writable roots cover every worktree of a multi-repository build and fail outside Git', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'aiden-codex-roots-')));
  try {
    const first = await repository(path.join(root, 'api'));
    const second = await repository(path.join(root, 'ui'));
    assert.deepEqual(await writableRoots(first.worktree, [second.worktree]), [
      first.worktree,
      path.join(first.clone, '.git'),
      second.worktree,
      path.join(second.clone, '.git'),
    ]);
    await assert.rejects(writableRoots(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
