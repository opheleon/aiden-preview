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
  dashboardUrl,
} from '../packages/core/src/accounts/client.js';
import { documentFor, materialize } from '../packages/core/src/accounts/documents.js';
import { InventoryProbe } from '../packages/core/src/accounts/inventory.js';
import { reconcileProjectStatus } from '../packages/core/src/accounts/project-status.js';
import { AccountSession } from '../packages/core/src/accounts/session.js';
import { verifyServices } from '../packages/core/src/accounts/verify-task.js';
import { Engine } from '../packages/core/src/engine.js';
import { decideProject, readLifecycle } from '../packages/core/src/project-lifecycle.js';
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
    role: null,
    reviewerUserId: null,
    parentTaskId: null,
    revisionOf: null,
    verification: null,
    review: null,
    checks: [],
    timeline: { startedAt: at, reviewAt: null, verifyAt: null, finishedAt: null },
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
  return { f, store, engine, session, agent, calls, script, project, client };
}

void test("a team project carries its GitHub organizations to every member's copy", async () => {
  const { engine, store, project } = await setup();
  try {
    const shared = { ...project, githubOrganizations: ['opheleon-demo'] };
    await materialize(engine, serverProject(shared), true);
    const local = JSON.parse(
      await readFile(path.join(store.project(project.id), 'project.json'), 'utf8'),
    ) as { githubOrganizations?: string[] };
    assert.deepEqual(local.githubOrganizations, ['opheleon-demo']);
  } finally {
    await engine.dispose();
  }
});

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
      sample: { tools: Record<string, unknown>; usageCapPct: number; taskKinds: string[] };
    };
    assert.deepEqual(body.sample.tools.gh, { installed: true, signedIn: true });
    assert.equal(body.sample.usageCapPct, 70);
    // The team only assigns kinds this version runs, such as the daily Morning check.
    assert.deepEqual(body.sample.taskKinds, [
      'write-requirements',
      'check-code',
      'build',
      'verify',
    ]);
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

void test('a leased Morning check runs a morning code check here instead of being refused', async () => {
  const { agent, calls, script, session, engine, store, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    await materialize(engine, serverProject(project), true);
    const prepared = await engine.prepare(project, { autoAccept: true });
    await engine.wait(prepared.runId);
    const baseline = JSON.parse(
      await readFile(path.join(store.project(project.id), 'baseline.json'), 'utf8'),
    ) as Parameters<typeof documentFor>[1];
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit for this machine' },
      task: leased('check-code'),
      project: { ...serverProject(project), document: documentFor(project, baseline) },
    });
    await agent.poll(poll);
    await agent.idle();
    // A team project keeps only GitHub clones, so this fixture's check has no code to read and
    // ends unfinished; what matters here is that the kind runs as a check, not a refusal.
    const failed = calls.find((c) => c.method === 'fail')?.args[1] as
      { error?: string } | undefined;
    assert.doesNotMatch(failed?.error ?? '', /cannot do/);
    const runs = await engine.history(project.id);
    assert.ok(
      runs.some((run) => run.kind === 'report' && run.reason === 'morning'),
      'a morning code check ran on this machine',
    );
    assert.equal(
      calls.some((c) => c.method === 'replaceDocument'),
      false,
      'a check leaves the shared document unchanged',
    );
  } finally {
    await engine.dispose();
  }
});

void test('a Morning check on a project with no requirements yet finishes with a note, not a file error', async () => {
  const { agent, calls, script, session, engine, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit for this machine' },
      task: leased('check-code'),
      project: serverProject(project),
    });
    await agent.poll(poll);
    await agent.idle();
    assert.equal(
      calls.some((c) => c.method === 'fail'),
      false,
    );
    const complete = calls.find((c) => c.method === 'complete')?.args[1] as
      { result?: { note?: string; total?: number } } | undefined;
    assert.match(complete?.result?.note ?? '', /no requirements/);
    assert.equal(complete?.result?.total, 0);
    assert.equal((await engine.history(project.id)).length, 0, 'no check ran');
  } finally {
    await engine.dispose();
  }
});

void test('closing a team project closes it for the team, and the newer decision wins either way', async () => {
  const { calls, script, engine, store, project, client } = await setup();
  try {
    await materialize(engine, serverProject(project), true);
    const pushed: string[] = [];
    engine.onProjectStatus = (_id, status) => {
      pushed.push(status);
      return Promise.resolve();
    };
    await decideProject(engine, project.id, { action: 'closed', note: '' });
    assert.deepEqual(pushed, ['closed'], 'closing here tells the team');

    // The team missed it (say it was offline), and its last change is older: it closes there.
    const listed = { id: project.id, name: 'Books', revision: 1, status: 'active' as const };
    script.project = () => ({ ...serverProject(project), updatedAt: '2020-01-01T00:00:00.000Z' });
    const [sent] = await reconcileProjectStatus(engine, client, [listed]);
    assert.equal(sent?.status, 'closed');
    assert.deepEqual(calls.find((c) => c.method === 'setProjectStatus')?.args, [
      project.id,
      'closed',
    ]);

    // A teammate reopened it after that: it reopens here, with nothing deleted.
    script.project = () => ({ ...serverProject(project), updatedAt: '2099-01-01T00:00:00.000Z' });
    const [kept] = await reconcileProjectStatus(engine, client, [listed]);
    assert.equal(kept?.status, 'active');
    const lifecycle = await readLifecycle(store, project.id);
    assert.equal(lifecycle.status, 'active');
    assert.equal(lifecycle.history.at(-1)?.note, 'Reopened by your team.');
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
    const failed = calls.find((c) => c.method === 'fail')?.args[1] as {
      error: string;
      permanent?: boolean;
    };
    assert.match(failed.error, /cannot do "Something new" yet/);
    // An updated machine may run it, so the team retries it elsewhere.
    assert.equal(failed.permanent, undefined);
  } finally {
    await engine.dispose();
  }
});

void test('a verify task with no pull request fails for good, and one with PRs completes with CI checks', async (t) => {
  const { agent, calls, script, session, engine, project } = await setup();
  try {
    await session.saveRefresh('refresh-token');
    const verify = { ...leased('verify'), instructions: 'Nothing to check here' };
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit' },
      task: verify,
      project: serverProject(project),
    });
    await agent.poll(poll);
    await agent.idle();
    const failed = calls.find((c) => c.method === 'fail')?.args[1] as {
      error: string;
      permanent?: boolean;
    };
    assert.match(failed.error, /names no GitHub pull request/);
    assert.equal(failed.permanent, true);
    assert.equal(
      calls.some((c) => c.method === 'replaceDocument'),
      false,
      'verifying never copies or uploads the project',
    );
    t.mock.method(verifyServices, 'checks', () =>
      Promise.resolve([{ name: 'build', bucket: 'pass', link: null }]),
    );
    script.next = () => ({
      decision: { type: 'assign', reason: 'Best fit' },
      task: { ...verify, instructions: 'https://github.com/acme/api/pull/12' },
      project: serverProject(project),
    });
    await agent.poll(poll);
    await agent.idle();
    const complete = calls.find((c) => c.method === 'complete')?.args[1] as {
      checks?: unknown[];
      review?: unknown;
    };
    assert.deepEqual(complete.checks, [
      {
        name: 'CI: acme/api#12',
        kind: 'automated',
        url: 'https://github.com/acme/api/pull/12',
        state: 'passed',
        detail: '1 check passed',
      },
    ]);
    assert.equal(complete.review, undefined);
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
  assert.equal(accountsUrl({}), 'https://api.opheleon.ai');
  assert.equal(dashboardUrl({}), 'https://app.opheleon.ai');
  assert.equal(
    dashboardUrl({ AIDEN_ACCOUNTS_URL: 'https://api-beta.opheleon.ai' }),
    'https://app-beta.opheleon.ai',
  );
  assert.equal(
    accountsUrl({ AIDEN_ACCOUNTS_URL: 'http://localhost:8787' }),
    'http://localhost:8787',
  );
  assert.throws(() => accountsUrl({ AIDEN_ACCOUNTS_URL: 'http://example.com' }), /HTTPS/);
  assert.equal(
    dashboardUrl({ AIDEN_ACCOUNTS_URL: 'https://api.example.com' }),
    'https://app.example.com',
  );
  assert.equal(
    dashboardUrl({ AIDEN_DASHBOARD_URL: 'https://teams.example.com/x' }),
    'https://teams.example.com',
  );
  assert.equal(
    dashboardUrl({ AIDEN_ACCOUNTS_URL: 'http://localhost:8787' }),
    'http://localhost:8787',
  );
});
