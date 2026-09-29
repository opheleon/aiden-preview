import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import type { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { createMethods, type RuntimeControls } from '../packages/core/src/worker-methods.js';
import { settingsFile } from '../packages/verification/src/index.js';

const projectId = randomUUID();
const reportRunId = randomUUID();

/** Engine stand-in that records calls; only the members the worker methods touch exist. */
function stubEngine(
  store: Store,
  reportStatus: RunManifest['status'],
  verify: () => Promise<{ runId: string }> = () => Promise.resolve({ runId: randomUUID() }),
) {
  const calls: string[] = [];
  const events: RunEvent[] = [];
  const engine = {
    store,
    report: () => Promise.resolve({ runId: reportRunId }),
    wait: (runId: string) => {
      calls.push(`wait:${runId}`);
      return Promise.resolve();
    },
    state: () =>
      Promise.resolve({
        project: null,
        baseline: null,
        runs: [
          { id: reportRunId, status: reportStatus },
          { id: 'crashed-run', status: 'running' },
        ],
      }),
    isActive: (runId: string) => runId === reportRunId,
    verify: () => {
      calls.push('verify');
      return verify();
    },
    emit: (event: RunEvent) => events.push(event),
  };
  const methods = createMethods(engine as unknown as Engine, {} as RuntimeControls);
  return { methods, calls, events };
}

/** A store whose project has the given saved app URL, or none. */
async function storeWith(url: string | null): Promise<{ store: Store; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-worker-methods-'));
  const store = new Store(root);
  const projectDir = store.project(projectId);
  await mkdir(projectDir, { recursive: true });
  if (url) await writeFile(settingsFile(projectDir), JSON.stringify({ url }), { mode: 0o600 });
  return { store, root };
}

/** Let the detached follow-up finish its file reads before asserting what it did. */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
}

void test('state marks only runs this worker is executing as active', async () => {
  const { store, root } = await storeWith(null);
  try {
    const { methods } = stubEngine(store, 'running');
    const state = (await methods.state({ projectId })) as { activeRunIds: string[] };
    assert.deepEqual(state.activeRunIds, [reportRunId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a status refresh checks the saved app URL only after the code assessment completes', async () => {
  const { store, root } = await storeWith('http://localhost:5173/');
  try {
    const plain = stubEngine(store, 'completed');
    assert.deepEqual(await plain.methods.report({ projectId }), { runId: reportRunId });
    await settle(() => false);
    assert.deepEqual(plain.calls, []);

    const chained = stubEngine(store, 'completed');
    await chained.methods.report({ projectId, browserCheck: true });
    await settle(() => chained.calls.includes('verify'));
    assert.deepEqual(chained.calls, [`wait:${reportRunId}`, 'verify']);

    const failed = stubEngine(store, 'failed');
    await failed.methods.report({ projectId, browserCheck: true });
    await settle(() => false);
    assert.deepEqual(failed.calls, [`wait:${reportRunId}`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a status refresh without an app URL assesses the code only', async () => {
  const { store, root } = await storeWith(null);
  try {
    const { methods, calls, events } = stubEngine(store, 'completed');
    await methods.report({ projectId, browserCheck: true });
    await settle(() => false);
    assert.deepEqual(calls, [`wait:${reportRunId}`]);
    assert.deepEqual(events, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a browser check that cannot start is reported on the finished assessment', async () => {
  const { store, root } = await storeWith('http://localhost:5173/');
  try {
    const { methods, events } = stubEngine(store, 'completed', () =>
      Promise.reject(new Error('Another run is active for this project.')),
    );
    await methods.report({ projectId, browserCheck: true });
    await settle(() => events.length > 0);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'failed');
    assert.equal(events[0]?.runId, reportRunId);
    assert.match(
      events[0]?.message ?? '',
      /^The code assessment finished, but the browser check could not start\./,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
