import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { AccountProject, AccountTask } from '../packages/contracts/src/accounts-api.js';
import { AccountAgent } from '../packages/core/src/accounts/agent.js';
import {
  type AccountsClient,
  AccountsError,
  accountsUrl,
} from '../packages/core/src/accounts/client.js';
import { documentFor, materialize } from '../packages/core/src/accounts/documents.js';
import { InventoryProbe } from '../packages/core/src/accounts/inventory.js';
import { AccountSession } from '../packages/core/src/accounts/session.js';
import { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const at = '2026-10-20T15:00:00.000Z';
const poll = { idleSeconds: 600, onBattery: false, busy: false };

/** An account project whose document is the fixture project with no code yet. */
function serverProject(project: Parameters<typeof documentFor>[0], revision = 1): AccountProject {
  return {
    id: 'acct-project-1',
    accountId: 'acct-1',
    name: 'Books',
    runtime: project.runtime,
    document: documentFor(project, null),
    revision,
    status: 'active',
    createdAt: at,
    updatedAt: at,
  };
}

/** A leased agent task. */
function leased(kind: string): AccountTask {
  return {
    id: `task-${kind}`,
    accountId: 'acct-1',
    projectId: 'acct-project-1',
    actor: 'agent',
    kind,
    title: kind === 'write-requirements' ? 'Write requirements' : 'Something new',
    instructions: '',
    requirementIds: [],
    requires: {
      tools: [],
      connections: [],
      runtime: null,
      pinnedUserId: null,
      pinnedDeviceId: null,
    },
    status: 'leased',
    blockedBy: null,
    assigneeUserId: null,
    leasedDeviceId: 'device',
    leaseExpiresAt: new Date(new Date(at).getTime() + 300_000).toISOString(),
    attempts: 1,
    execution: {
      attemptId: `task-${kind}:1`,
      location: 'local',
      startedAt: at,
      deadlineAt: new Date(new Date(at).getTime() + 2 * 60 * 60_000).toISOString(),
      activityAt: at,
      activitySequence: 0,
      reportedAt: null,
      phase: 'running',
      checkpoint: null,
      limits: { idleMs: 600_000, toolMs: 1_800_000, absoluteMs: 7_200_000 },
    },
    result: null,
    resume: null,
    queuedAt: at,
    updatedAt: at,
  };
}

/** Engine on the fixture runtime, a signed-in session, and a scripted Accounts client. */
async function setup() {
  const f = await fixture();
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, new FixtureRuntime(f));
  engine.discover = { fetch: () => Promise.reject(new Error('connection refused')) };
  const session = new AccountSession(store);
  const calls: { method: string; args: unknown[] }[] = [];
  const script: Record<string, (...args: unknown[]) => unknown> = {};
  const client = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          return Promise.resolve(script[method]?.(...args));
        },
    },
  ) as AccountsClient;
  const inventory = new InventoryProbe({
    diagnostics: () => Promise.resolve([]),
    connections: () => Promise.resolve([]),
    command: () => Promise.resolve(),
    browsersInstalled: () => true,
  });
  const agent = new AccountAgent(engine, session, client, inventory, () => new Date(at));
  const project = { ...f.project, id: 'acct-project-1', repositories: [] };
  return { f, store, engine, session, agent, calls, script, project };
}

void test('a signed-out machine never asks the account for work', async () => {
  const { agent, calls, engine } = await setup();
  try {
    assert.deepEqual(await agent.poll(poll), { pollAfterSeconds: 30 });
    assert.equal(calls.length, 0);
  } finally {
    await engine.dispose();
  }
});

void test('a hold is reported with its reason and the suggested wait, with verified tools in the sample', async () => {
  const { agent, calls, script, session, engine } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    script.next = () => ({
      decision: {
        type: 'hold',
        code: 'pickup_off',
        reason: 'Picking up account work is off',
        pollAfterSeconds: 300,
      },
      task: null,
      project: null,
    });
    assert.deepEqual(await agent.poll(poll), { pollAfterSeconds: 300 });
    assert.deepEqual(agent.status().last, {
      type: 'hold',
      reason: 'Picking up account work is off',
      at,
    });
    const body = calls[0]?.args[0] as {
      sample: { tools: Record<string, unknown>; usageCapPct: number };
    };
    assert.deepEqual(body.sample.tools.gh, { installed: true, signedIn: true });
    assert.equal(body.sample.usageCapPct, 70);
  } finally {
    await engine.dispose();
  }
});

void test('a leased Write requirements task runs here, uploads the baseline, and completes', async () => {
  const { agent, calls, script, session, engine, store, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    const server = serverProject(project);
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit for this machine' },
      task: leased('write-requirements'),
      project: server,
    });
    script.replaceDocument = (_id, revision, document) => ({
      ...server,
      revision: (revision as number) + 1,
      document,
    });
    assert.deepEqual(await agent.poll(poll), { pollAfterSeconds: 60 });
    assert.equal(agent.status().running?.title, 'Write requirements');
    await agent.idle();
    const upload = calls.find((c) => c.method === 'replaceDocument');
    assert.equal(typeof upload?.args[3], 'string', 'the upload carries the project name');
    const uploaded = upload?.args[2] as { baseline: { product: { requirements: unknown[] } } };
    assert.ok(
      uploaded.baseline.product.requirements.length > 0,
      'the document carries the new baseline',
    );
    const complete = calls.find((c) => c.method === 'complete');
    assert.ok(complete, 'the task is completed');
    assert.equal(
      calls.some((c) => c.method === 'fail'),
      false,
    );
    const local = JSON.parse(
      await readFile(path.join(store.project(project.id), 'project.json'), 'utf8'),
    ) as { account: unknown };
    assert.deepEqual(local.account, { accountId: 'acct-1', revision: 2 });
    assert.equal(agent.status().running, null);
  } finally {
    await engine.dispose();
  }
});

void test('a task the team stops while it runs here is cancelled locally and its result dropped', async () => {
  const { agent, calls, script, session, engine, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit for this machine' },
      task: leased('write-requirements'),
      project: serverProject(project),
    });
    await agent.poll(poll);
    await agent.stop('some-other-task');
    assert.equal(agent.status().running?.title, 'Write requirements', 'other tasks are left alone');
    await agent.stop('task-write-requirements');
    await agent.idle();
    for (const method of ['replaceDocument', 'complete', 'fail'])
      assert.equal(
        calls.some((c) => c.method === method),
        false,
        `a stopped task does not ${method}`,
      );
    assert.equal(agent.status().running, null);
  } finally {
    await engine.dispose();
  }
});

void test('a task this version cannot run goes back to the queue with a plain reason', async () => {
  const { agent, calls, script, session, engine, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit' },
      task: leased('check-app'),
      project: serverProject(project),
    });
    await agent.poll(poll);
    await agent.idle();
    const failed = calls.find((c) => c.method === 'fail')?.args[1] as { error: string };
    assert.match(failed.error, /cannot do "Something new" yet/);
  } finally {
    await engine.dispose();
  }
});

void test('a revision conflict keeps the newer project and adds this machine’s baseline', async () => {
  const { agent, calls, script, session, engine, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    const server = serverProject(project);
    await materialize(engine, server, true);
    const newer = serverProject(
      { ...project, context: 'Edited elsewhere. Users can list books.' },
      3,
    );
    let attempts = 0;
    script.replaceDocument = (_id, revision, document) => {
      attempts += 1;
      if (attempts === 1) throw new AccountsError(409, 'conflict', 'changed');
      return { ...newer, revision: (revision as number) + 1, document };
    };
    script.project = () => newer;
    await agent.upload(project.id);
    const retry = calls.filter((c) => c.method === 'replaceDocument')[1]!;
    assert.equal(retry.args[1], 3);
    assert.match(
      (retry.args[2] as { project: { context: string } }).project.context,
      /Edited elsewhere/,
    );
  } finally {
    await engine.dispose();
  }
});

void test('materializing keeps only GitHub clones under this project and skips a copy already at that revision', async () => {
  const { engine, project, store } = await setup();
  try {
    const cloned = {
      ...project,
      repositories: [
        {
          id: 'web',
          path: '/Users/someone-else/.aiden/projects/acct-project-1/code/acme/web',
          notes: '',
          source: { kind: 'github' as const, name: 'acme/web', url: 'https://github.com/acme/web' },
        },
      ],
    };
    const hostile = {
      ...cloned,
      repositories: [
        ...cloned.repositories,
        { id: 'keys', path: '/Users/victim/.ssh', notes: '' },
        {
          id: 'escape',
          path: '/tmp/x',
          notes: '',
          source: { kind: 'github' as const, name: '../etc', url: 'https://github.com/a/b' },
        },
      ],
    };
    const written = await materialize(engine, serverProject(hostile, 2), true);
    assert.deepEqual(
      written?.repositories.map((r) => r.path),
      [path.join(store.project(project.id), 'code', 'github', 'acme', 'web')],
    );
    const again = await materialize(engine, serverProject({ ...cloned, context: 'ignored' }, 2));
    assert.notEqual(again?.context, 'ignored');
    assert.equal(
      await materialize(engine, { ...serverProject(project), document: { schemaVersion: 99 } }),
      null,
    );
  } finally {
    await engine.dispose();
  }
});

void test('inventory reports verified tools, exact provider modes, and connected trackers', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const probe = new InventoryProbe({
    diagnostics: () =>
      Promise.resolve([
        { provider: 'claude', installed: true, ready: true, subscription: true, apiKey: false },
        { provider: 'codex', installed: true, ready: false, subscription: false, apiKey: true },
      ]),
    connections: () =>
      Promise.resolve([{ url: 'https://mcp.linear.app/mcp', status: 'connected' } as never]),
    command: (file) => (file === 'gh' ? Promise.reject(missing) : Promise.resolve()),
    browsersInstalled: () => false,
  });
  const inventory = await probe.read();
  assert.deepEqual(inventory.tools.gh, { installed: false });
  assert.deepEqual(inventory.tools.playwright, { installed: false });
  assert.deepEqual(
    inventory.providers.map((p) => `${p.provider}:${p.auth}`),
    ['claude:subscription', 'codex:apiKey'],
  );
  assert.equal(inventory.connections.linear, true);
  assert.equal(await probe.read(), inventory, 'cached for five minutes');
  const signedOut = new InventoryProbe({
    diagnostics: () => Promise.reject(new Error('down')),
    connections: () => Promise.resolve([]),
    command: () => Promise.reject(new Error('not signed in')),
  });
  assert.deepEqual((await signedOut.read()).tools.gh, { installed: true, signedIn: false });
});

void test('server URLs and errors are handled safely', () => {
  assert.equal(accountsUrl({}), 'https://accounts.opheleon.ai');
  assert.equal(
    accountsUrl({ AIDEN_ACCOUNTS_URL: 'http://localhost:8787' }),
    'http://localhost:8787',
  );
  assert.throws(() => accountsUrl({ AIDEN_ACCOUNTS_URL: 'http://example.com' }), /HTTPS/);
});
