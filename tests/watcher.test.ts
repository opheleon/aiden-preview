import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { localDay, ProjectWatcher } from '../apps/desktop/src/watcher.js';

type Heads = { ready: boolean; active: boolean; changed: boolean; lastLookAt?: string | null };

/** A watcher over a fake worker: one project whose heads and clock the test controls. */
async function fixture(initial: Partial<Heads> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-watcher-'));
  let now = new Date(2026, 8, 29, 7, 30);
  let busy = false;
  let fail = false;
  let closed = false;
  const operations: string[] = [];
  let needsAssessment = false;
  let heads: Heads = { ready: true, active: false, changed: false, ...initial };
  const looks: { projectId: string; reason?: string }[] = [];
  const errors: string[] = [];
  const watcher = new ProjectWatcher({
    dataRoot: root,
    now: () => now,
    isBusy: () => busy,
    onError: (message) => errors.push(message),
    worker: {
      request: ((method: string, params: { projectId: string; reason?: string }) => {
        if (fail) return Promise.reject(new Error('worker unavailable'));
        operations.push(method);
        if (method === 'projects')
          return Promise.resolve([
            { id: 'project', lifecycle: { status: closed ? 'closed' : 'active' } },
          ]);
        if (method === 'reconcileDelivery') return Promise.resolve([]);
        if (method === 'syncTickets')
          return Promise.resolve({ settings: { enabled: true }, needsAssessment });
        if (method === 'heads') return Promise.resolve({ repositories: [], ...heads });
        if (method === 'look') {
          looks.push(params);
          return Promise.resolve({ runId: 'look-run' });
        }
        return Promise.reject(new Error(`unexpected ${method}`));
      }) as never,
    },
  });
  await watcher.start(false);
  return {
    root,
    operations,
    closed: (value: boolean) => (closed = value),
    watcher,
    looks,
    errors,
    set: (next: Partial<Heads>) => (heads = { ...heads, ...next }),
    at: (date: Date) => (now = date),
    busy: (value: boolean) => (busy = value),
    ticketsChanged: (value: boolean) => (needsAssessment = value),
    failing: (value: boolean) => (fail = value),
  };
}

void test('the watcher looks only when code changed, and never while Aiden is working', async () => {
  const f = await fixture();
  try {
    await f.watcher.tick();
    assert.deepEqual(f.looks, [], 'no change before the morning means no look');
    f.set({ changed: true, active: true });
    await f.watcher.tick();
    assert.deepEqual(f.looks, [], 'an active run on the project defers the look');
    f.set({ active: false });
    f.busy(true);
    await f.watcher.tick();
    assert.deepEqual(f.looks, [], 'any active run in the app defers the look');
    f.busy(false);
    await f.watcher.tick();
    assert.deepEqual(f.looks, [{ projectId: 'project', reason: 'commit' }]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('one morning look a day is saved across restarts, and projects without a baseline are skipped', async () => {
  const f = await fixture({ ready: false });
  try {
    f.at(new Date(2026, 8, 29, 8, 5));
    await f.watcher.tick();
    assert.deepEqual(f.looks, [], 'nothing to look against yet');
    f.set({ ready: true });
    await f.watcher.tick();
    assert.deepEqual(f.looks, [{ projectId: 'project', reason: 'morning' }]);
    await f.watcher.tick();
    assert.equal(f.looks.length, 1, 'the morning look runs once a day');
    const saved = JSON.parse(
      await readFile(path.join(f.root, 'preferences', 'watch.json'), 'utf8'),
    );
    assert.equal(saved.mornings.project, localDay(new Date(2026, 8, 29, 8, 5)));
    const restarted = new ProjectWatcher({
      dataRoot: f.root,
      now: () => new Date(2026, 8, 29, 9, 0),
      isBusy: () => false,
      worker: {
        request: ((method: string, params: unknown) => {
          if (method === 'projects') return Promise.resolve([{ id: 'project' }]);
          if (method === 'reconcileDelivery' || method === 'syncTickets')
            return Promise.resolve([]);
          if (method === 'heads')
            return Promise.resolve({
              repositories: [],
              ready: true,
              active: false,
              changed: false,
            });
          f.looks.push(params as never);
          return Promise.resolve({ runId: 'again' });
        }) as never,
      },
    });
    await restarted.start(false);
    await restarted.tick();
    assert.equal(f.looks.length, 1, 'a restart the same day does not repeat the morning look');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('worker failures are reported once and retried on the next check; stopping ends checks', async () => {
  const f = await fixture({ changed: true });
  try {
    f.failing(true);
    await Promise.all([f.watcher.tick(), f.watcher.tick()]);
    await f.watcher.tick();
    assert.equal(f.errors.length, 1);
    f.failing(false);
    await f.watcher.tick();
    assert.equal(f.looks.length, 1);
    f.watcher.stop();
    await f.watcher.tick();
    assert.equal(f.looks.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('a look already started today counts as the morning look', async () => {
  const f = await fixture({ lastLookAt: new Date(2026, 8, 29, 7, 0).toISOString() });
  try {
    f.at(new Date(2026, 8, 29, 9, 0));
    await f.watcher.tick();
    assert.deepEqual(f.looks, []);
    f.at(new Date(2026, 8, 30, 9, 0));
    await f.watcher.tick();
    assert.deepEqual(f.looks, [{ projectId: 'project', reason: 'morning' }]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('localDay uses the local calendar', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

void test('tracker changes trigger a fresh assessment even without commits and defer while busy', async () => {
  const f = await fixture();
  try {
    f.ticketsChanged(true);
    f.busy(true);
    await f.watcher.tick();
    assert.deepEqual(f.looks, []);
    f.busy(false);
    await f.watcher.tick();
    assert.deepEqual(f.looks, [{ projectId: 'project', reason: 'ticket' }]);
    f.ticketsChanged(false);
    await f.watcher.tick();
    assert.equal(f.looks.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('closed projects skip every monitoring and tracker operation until reopened', async () => {
  const f = await fixture({ changed: true });
  try {
    f.closed(true);
    f.at(new Date(2026, 8, 29, 9));
    await f.watcher.tick();
    assert.deepEqual(f.operations, ['projects']);
    f.closed(false);
    await f.watcher.tick();
    assert.deepEqual(f.looks, [{ projectId: 'project', reason: 'commit' }]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
