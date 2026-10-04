import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { reconcileDelivery } from '../packages/core/src/beta-delivery.js';
import { Engine } from '../packages/core/src/engine.js';
import { decideProject, readLifecycle } from '../packages/core/src/project-lifecycle.js';
import { acquireProjectLock } from '../packages/core/src/run-lifecycle.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import { syncTickets } from '../packages/core/src/ticket-sync.js';
import { createMethods, type RuntimeControls } from '../packages/core/src/worker-methods.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';
import { ticketFixture } from './ticket-fixture.js';

async function setup() {
  const f = await fixture();
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, new FixtureRuntime(f));
  const started = await engine.prepare(f.project);
  await engine.wait(started.runId);
  await engine.approve(f.project.id, started.runId, f.product);
  const methods = createMethods(engine, {} as RuntimeControls);
  const params = { projectId: f.project.id };
  return {
    ...f,
    engine,
    store,
    methods,
    params,
    close: async () => {
      await engine.dispose();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}

void test('human acceptance keeps automated evidence intact, rejects stale decisions, and retains history', async () => {
  const f = await setup();
  try {
    const started = await f.engine.report(f.project.id);
    await f.engine.wait(started.runId);
    const report = await f.engine.getReport(f.project.id);
    const baseline = await readFile(
      path.join(f.store.project(f.project.id), 'baseline.json'),
      'utf8',
    );
    const project = (await f.engine.state(f.project.id)).project!;
    assert.equal(project.lifecycle?.status, 'active');
    await assert.rejects(
      async () =>
        await f.methods.acceptOutcome({
          ...f.params,
          note: ' ',
          evidenceKey: project.lifecycle!.evidenceKey,
        }),
    );
    await assert.rejects(
      async () =>
        await f.methods.acceptOutcome({
          ...f.params,
          note: 'Reviewed manually',
          evidenceKey: 'a'.repeat(64),
        }),
      /changed/,
    );
    await f.methods.acceptOutcome({
      ...f.params,
      note: 'Reviewed manually; known gaps accepted.',
      evidenceKey: project.lifecycle.evidenceKey,
    });
    assert.equal((await f.engine.state(f.project.id)).project?.lifecycle?.acceptanceCurrent, true);
    assert.deepEqual(await f.engine.getReport(f.project.id), report);
    assert.equal(
      await readFile(path.join(f.store.project(f.project.id), 'baseline.json'), 'utf8'),
      baseline,
    );
    await f.methods.closeProject({ ...f.params, note: 'Outcome accepted; delivery finished.' });
    const restarted = new Engine(f.store, new FixtureRuntime(f));
    try {
      const persisted = (await restarted.projects())[0]!.lifecycle!;
      assert.equal(persisted.status, 'closed');
      assert.equal(persisted.acceptanceCurrent, true);
      assert.equal(persisted.acceptance?.note, 'Reviewed manually; known gaps accepted.');
      assert.deepEqual(
        persisted.history.map((event) => event.action),
        ['accepted', 'closed'],
      );
    } finally {
      await restarted.dispose();
    }
    await f.methods.reopenProject(f.params);
    await f.methods.reopenProject(f.params);
    await atomic(path.join(f.store.project(f.project.id), 'latest-verification.json'), {
      id: 'new-check',
    });
    const changed = (await f.engine.state(f.project.id)).project!.lifecycle!;
    assert.equal(changed.status, 'active');
    assert.equal(changed.acceptanceCurrent, false);
    assert.deepEqual(
      changed.history.map((event) => event.action),
      ['accepted', 'closed', 'reopened'],
    );
    assert.equal(changed.acceptance?.note, 'Reviewed manually; known gaps accepted.');
  } finally {
    await f.close();
  }
});

void test('closing unfinished work preserves history and blocks execution while allowing reads and reopening', async () => {
  const f = await setup();
  try {
    const before = await f.engine.history(f.project.id);
    await f.methods.closeProject({
      ...f.params,
      note: 'Cancelled initiative, retaining evidence.',
    });
    await f.methods.closeProject({ ...f.params, note: 'Duplicate request' });
    assert.equal((await readLifecycle(f.store, f.project.id)).acceptance, undefined);
    assert.equal((await readLifecycle(f.store, f.project.id)).history.length, 1);
    for (const method of ['look', 'report', 'estimate', 'verify'] as const)
      await assert.rejects(async () => await f.methods[method](f.params), /closed/);
    await assert.rejects(
      async () => await f.methods.editIntent({ ...f.params, context: 'Changed intent' }),
      /closed/,
    );
    await assert.rejects(f.engine.report(f.project.id), /closed/);
    await assert.rejects(f.engine.prepare({ ...f.project, lifecycle: undefined }), /closed/);
    await assert.rejects(f.engine.resume(f.project.id, before[0]!.id), /closed/);
    assert.deepEqual(await f.engine.history(f.project.id), before);
    assert.deepEqual(await reconcileDelivery(f.engine, f.project.id), []);
    assert.deepEqual(await syncTickets(f.engine, f.project.id), { settings: null, records: [] });
    await f.methods.monitoring(f.params);
    await f.methods.reopenProject(f.params);
    const next = await f.engine.report(f.project.id);
    await f.engine.wait(next.runId);
    assert.equal((await f.engine.history(f.project.id)).length, before.length + 1);
  } finally {
    await f.close();
  }
});

void test('project decisions reject active code, browser, and delivery operations and release partial locks', async () => {
  const f = await setup();
  try {
    for (const name of ['active', 'browser', 'delivery'] as const) {
      const release = await acquireProjectLock(f.store, f.project.id, name);
      await assert.rejects(
        async () => await f.methods.closeProject({ ...f.params, note: 'Closing' }),
        /active operation/,
      );
      await release();
    }
    assert.equal((await readLifecycle(f.store, f.project.id)).status, 'active');
    await f.methods.closeProject({ ...f.params, note: 'Now idle' });
    assert.equal((await readLifecycle(f.store, f.project.id)).status, 'closed');
  } finally {
    await f.close();
  }
});

void test('an in-flight worker write cannot cross a project decision', async () => {
  const f = await setup();
  try {
    let finish!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.engine.updateRuntime = async () => {
      entered();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const write = f.methods.updateRuntime({ ...f.params, runtime: f.project.runtime });
    await ready;
    await assert.rejects(
      async () => await f.methods.closeProject({ ...f.params, note: 'Closing' }),
      /still finishing/,
    );
    finish();
    await write;
    await f.methods.closeProject({ ...f.params, note: 'Now idle' });
  } finally {
    await f.close();
  }
});

void test('closing an enabled tracker makes reconciliation read-only until reopening', async () => {
  const f = await ticketFixture();
  try {
    await f.enable();
    await syncTickets(f.engine, f.project.id);
    const calls = [...f.calls];
    const issues = [...f.issues.values()].map((issue) => ({ ...issue }));
    await decideProject(f.engine, f.project.id, { action: 'closed', note: 'Pause this delivery.' });
    await syncTickets(f.engine, f.project.id);
    assert.deepEqual(f.calls, calls);
    assert.deepEqual([...f.issues.values()], issues);
    await decideProject(f.engine, f.project.id, { action: 'reopened', note: 'Continue.' });
    await syncTickets(f.engine, f.project.id);
    assert.ok(f.calls.length > calls.length);
  } finally {
    await f.close();
  }
});
