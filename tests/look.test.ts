import assert from 'node:assert/strict';
import { rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { Baseline, RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import { readCalls, recordCall } from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import {
  answerAndLook,
  editIntent,
  prepareAndLook,
  repositoryHeads,
  startLook,
} from '../packages/core/src/look.js';
import { acquireProjectLock } from '../packages/core/src/run-lifecycle.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { readAppUrl } from '../packages/core/src/verification-settings.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

/** Poll until a condition holds, failing after a few seconds instead of hanging. */
async function until(check: () => Promise<boolean> | boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/** An engine over the fixture repositories where nothing answers on localhost. */
async function setup() {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  runtime.understanding = {
    overview: f.product.overview,
    milestones: [],
    requirements: [
      {
        id: 'REQ-1',
        text: 'Users can list books.',
        edgeCases: [{ id: 'E1', text: 'An empty library says there are no books yet.' }],
      },
      { id: 'REQ-2', text: 'Users can create books.', edgeCases: [] },
    ],
    calls: [
      {
        requirementId: 'REQ-2',
        edgeCaseId: null,
        question: 'Can two books share a title?',
        options: ['Allow duplicates', 'Block duplicates'],
        assumption: 'Allow duplicates',
        owner: 'you',
      },
    ],
  };
  const events: RunEvent[] = [];
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime, (event) => events.push(event));
  e.discover = { fetch: () => Promise.reject(new Error('connection refused')) };
  const runs = async () => e.history(f.project.id);
  /** Wait for all expected runs, including chained estimates; gaps between runs are not idle. */
  const settled = (count: number, what: string) =>
    until(async () => {
      const all = await runs();
      return all.length >= count && all.every((r) => !e.isActive(r.id));
    }, what);
  return { f, runtime, events, store, e, runs, settled };
}

void test('handing over the intent writes what done means, commits it, and looks without review', async () => {
  const { f, e, store, runs, settled, events } = await setup();
  try {
    const before = await repositoryHeads(e, f.project.id).catch(() => null);
    assert.equal(before, null, 'an unsaved project has nothing to watch');
    await prepareAndLook(e, f.project, 'intent');
    await settled(3, 'the look and automatic sizing after preparing');
    assert.ok(!(await readCalls(store, f.project.id)).some((c) => c.kind === 'app-url'));
    const history = await runs();
    const look = history.find((r) => r.kind === 'report');
    const prepare = history.find((r) => r.kind === 'prepare');
    assert.equal(history.find((r) => r.kind === 'estimate')?.status, 'completed');
    assert.equal(prepare?.kind, 'prepare');
    assert.equal(prepare?.status, 'completed');
    assert.equal(prepare?.autoAccept, true);
    assert.equal(look?.kind, 'report');
    assert.equal(look?.reason, 'intent');
    const baseline = await json<Baseline>(path.join(store.project(f.project.id), 'baseline.json'));
    assert.equal(baseline.product.requirements[0]?.edgeCases?.[0]?.id, 'E1');
    const calls = await readCalls(store, f.project.id);
    assert.ok(
      calls.some((c) => c.kind === 'decision' && c.question === 'Can two books share a title?'),
    );
    assert.ok(
      events.some((ev) => ev.type === 'completed' && ev.runId === prepare?.id && ev.product),
    );
    assert.ok(!events.some((ev) => ev.type === 'review'), 'no review stop');

    const heads = await repositoryHeads(e, f.project.id);
    assert.deepEqual(heads.changed, false);
    assert.equal(heads.ready, true);
    assert.equal(heads.active, false);
    const repo = required(f.project.repositories[0]);
    await writeFile(path.join(repo.path, 'app.txt'), 'GET /books\nrender list\nempty state\n');
    await g(repo.path, 'commit', '-am', 'Empty state');
    assert.equal(
      (await repositoryHeads(e, f.project.id)).changed,
      false,
      'local-only commits cannot trigger remote delivery checks',
    );
    await rename(repo.path, `${repo.path}-moved`);
    const moved = await repositoryHeads(e, f.project.id);
    assert.equal(moved.repositories[0]?.sha, null);
    assert.equal(moved.changed, false, 'an unreadable repository never starts a look');
  } finally {
    await e.dispose();
  }
});

void test('answering a call acts on it, or right after the current work when Aiden is busy', async () => {
  const { f, e, store, runtime, runs, settled } = await setup();
  const verified: string[] = [];
  e.verify = (projectId: string, _url?: string, reason?: RunManifest['reason']) => {
    verified.push(`${projectId}:${reason}`);
    return Promise.resolve({ runId: 'verify-stub' });
  };
  try {
    const p = await e.prepare(f.project, { autoAccept: true, reason: 'intent' });
    await e.wait(p.runId);
    const decision = (await readCalls(store, f.project.id)).find((c) => c.kind === 'decision')!;
    const { call: where } = await recordCall(
      store,
      f.project.id,
      {
        requirementId: null,
        edgeCaseId: null,
        question: 'Where does your app run?',
        options: [],
        assumption: 'Checking the code only.',
        owner: 'you',
      },
      'app-url',
      p.runId,
    );
    await assert.rejects(answerAndLook(e, f.project.id, where.id, 'not a url'), /full URL/);
    assert.equal(
      (await readCalls(store, f.project.id)).find((c) => c.id === where.id)?.status,
      'open',
    );
    const answered = await answerAndLook(e, f.project.id, where.id, 'http://localhost:4321');
    assert.equal(answered.call.answer, 'http://localhost:4321/');
    assert.equal((await readAppUrl(e, f.project.id)).url, 'http://localhost:4321/');
    assert.deepEqual(verified, [], 'Saving a URL never runs local verification');
    await assert.rejects(answerAndLook(e, f.project.id, where.id, 'again'), /no longer open/);

    runtime.pause = true;
    const busy = await startLook(e, f.project.id, 'commit');
    await until(() => runtime.calls.includes('assess'), 'the paused assessment');
    const later = await answerAndLook(e, f.project.id, decision.id, 'Block duplicates');
    assert.equal(later.runId, null, 'Aiden is busy, so the answer waits for the current work');
    runtime.pause = false;
    // Stopping the look ends the current work, so Aiden rewrites what done means with the answer.
    e.cancel(busy.runId);
    await until(
      async () => (await runs()).some((r) => r.kind === 'prepare' && r.reason === 'answer'),
      'the rewrite the waiting answer started',
    );
    await settled(5, 'the look and sizing after the rewrite');

    const { call: second } = await recordCall(
      store,
      f.project.id,
      {
        requirementId: 'REQ-1',
        edgeCaseId: null,
        question: 'Sort books by title or date?',
        options: [],
        assumption: 'Title',
        owner: 'you',
      },
      'decision',
      null,
    );
    const now = await answerAndLook(e, f.project.id, second.id, 'Date');
    assert.ok(now.runId);
    await settled(8, 'the rewrite, look, and sizing after an answer');
    const rewrite = (await runs()).find((r) => r.id === now.runId);
    assert.equal(rewrite?.kind, 'prepare');
    assert.equal(rewrite?.reason, 'answer');
  } finally {
    await e.dispose();
  }
});

void test('editing what done means commits it and looks; changing the intent rewrites it first', async () => {
  const { f, e, store, runs, settled } = await setup();
  try {
    const p = await e.prepare(f.project, { autoAccept: true, reason: 'intent' });
    await e.wait(p.runId);
    const saved = await json<Baseline>(path.join(store.project(f.project.id), 'baseline.json'));
    const product = {
      ...saved.product,
      requirements: saved.product.requirements.map((r) => ({ id: r.id, text: r.text })),
    };
    const look = await editIntent(e, f.project.id, { product });
    await settled(3, 'the look and sizing after an edit');
    const edited = await json<Baseline>(path.join(store.project(f.project.id), 'baseline.json'));
    assert.equal(
      edited.product.requirements[0]?.edgeCases,
      undefined,
      'the removed edge case is gone',
    );
    assert.equal((await runs()).find((r) => r.id === look.runId)?.reason, 'intent');

    const rewrite = await editIntent(e, f.project.id, {
      context: 'Users can list and delete books.',
    });
    await settled(6, 'the rewrite, look, and sizing after changing the intent');
    const run = (await runs()).find((r) => r.id === rewrite.runId);
    assert.equal(run?.kind, 'prepare');
    assert.equal(run?.project.context, 'Users can list and delete books.');
    const baseline = await json<Baseline>(path.join(store.project(f.project.id), 'baseline.json'));
    assert.equal(baseline.product.requirements[0]?.edgeCases?.[0]?.id, 'E1');
  } finally {
    await e.dispose();
  }
});

void test('manual checks capture new local commits after interruption; commit checks also start fresh', async () => {
  const { f, e, runtime, runs, settled } = await setup();
  try {
    const p = await e.prepare(f.project, { autoAccept: true, reason: 'intent' });
    await e.wait(p.runId);
    runtime.pause = true;
    const first = await startLook(e, f.project.id, 'commit');
    await until(() => runtime.calls.includes('assess'), 'the paused assessment');
    e.cancel(first.runId);
    await e.wait(first.runId);
    runtime.pause = false;
    const inventory = path.join(e.store.run(f.project.id, first.runId), 'inventory.json');
    const frozenAt = (await stat(inventory)).mtimeMs;
    const repo = f.project.repositories[0]!;
    await g(repo.path, 'checkout', '-b', 'local/new-implementation');
    await writeFile(path.join(repo.path, 'app.txt'), 'GET /books\nrender updated list\n');
    await g(repo.path, 'add', 'app.txt');
    await g(repo.path, 'commit', '-m', 'New local implementation after cancellation');
    const head = await g(repo.path, 'rev-parse', 'HEAD');
    f.snapshots[0]!.sha = head;
    const again = await startLook(e, f.project.id, 'you');
    assert.notEqual(again.runId, first.runId, 'manual checks never resume interrupted snapshots');
    await settled(4, 'the new look and automatic sizing');
    const freshInventory = await json<{ inventory: { repositoryId: string; head: string }[] }>(
      path.join(e.store.run(f.project.id, again.runId), 'inventory.json'),
    );
    assert.equal(freshInventory.inventory.find((row) => row.repositoryId === repo.id)?.head, head);
    assert.equal((await stat(inventory)).mtimeMs, frozenAt, 'old evidence stays in history');
    assert.equal((await runs()).find((r) => r.id === first.runId)?.status, 'cancelled');
    assert.equal((await runs()).find((r) => r.id === again.runId)?.status, 'completed');
    runtime.pause = true;
    const stopped = await startLook(e, f.project.id, 'you');
    await until(
      () => runtime.calls.filter((stage) => stage === 'assess').length >= 3,
      'the second paused assessment',
    );
    e.cancel(stopped.runId);
    await e.wait(stopped.runId);
    runtime.pause = false;
    const fresh = await startLook(e, f.project.id, 'commit');
    assert.notEqual(fresh.runId, stopped.runId, 'new commits mean a fresh look');
    await settled(7, 'the fresh look and automatic sizing');
    const heads = await repositoryHeads(e, f.project.id);
    assert.ok(heads.lastLookAt);
  } finally {
    await e.dispose();
  }
});

void test('an answer given while what done means is being rewritten triggers another rewrite before looking', async () => {
  const { f, e, store, runtime, runs, settled } = await setup();
  let release = () => {};
  runtime.holdUnderstand = new Promise((resolve) => (release = resolve));
  try {
    const first = await prepareAndLook(e, f.project, 'intent');
    await until(() => runtime.calls.includes('understand'), 'the held rewrite');
    const { call } = await recordCall(
      store,
      f.project.id,
      {
        requirementId: null,
        edgeCaseId: null,
        question: 'Which shelf comes first?',
        options: [],
        assumption: 'Newest first',
        owner: 'you',
      },
      'decision',
      null,
    );
    const answered = await answerAndLook(e, f.project.id, call.id, 'Oldest first');
    assert.equal(answered.runId, null);
    runtime.holdUnderstand = null;
    release();
    await settled(4, 'the second rewrite, look, and sizing');
    const all = await runs();
    const prepares = all.filter((r) => r.kind === 'prepare');
    assert.equal(prepares.length, 2);
    assert.ok(prepares.some((r) => r.id !== first.runId && r.reason === 'answer'));
    assert.equal(
      all.filter((r) => r.kind === 'report').length,
      1,
      'only one look, after the rewrite',
    );
  } finally {
    await e.dispose();
  }
});

void test('a code look never launches local verification and reads only the chosen repositories', async () => {
  const { f, e, store, runtime, runs } = await setup();
  const started: string[] = [];
  e.verify = (projectId: string) => {
    started.push(projectId);
    return Promise.resolve({ runId: 'verify-stub' });
  };
  try {
    const first = required(f.project.repositories[0]);
    runtime.understanding = { ...runtime.understanding!, repositories: [first.id] };
    const p = await e.prepare(f.project, { autoAccept: true, reason: 'intent' });
    await e.wait(p.runId);
    await atomic(path.join(store.project(f.project.id), 'verification.json'), {
      url: 'http://localhost:4321/',
    });
    runtime.pause = true;
    const look = await startLook(e, f.project.id, 'you');
    assert.deepEqual(started, [], 'Local verification belongs to the external coding agent');
    assert.ok(e.isActive(look.runId), 'the code check is still running');
    const manifest = (await runs()).find((r) => r.id === look.runId)!;
    assert.deepEqual(
      manifest.project.repositories.map((r) => r.id),
      [first.id],
    );
    const saved = await json<{ repositories: unknown[] }>(
      path.join(store.project(f.project.id), 'project.json'),
    );
    assert.equal(saved.repositories.length, 2, 'the project keeps every repository');
    const heads = await repositoryHeads(e, f.project.id);
    assert.deepEqual(
      heads.repositories.map((r) => r.repositoryId),
      [first.id],
      'only commits in the chosen repositories start a look',
    );
    e.cancel(look.runId);
    await e.wait(look.runId);
    runtime.pause = false;
  } finally {
    await e.dispose();
  }
});

void test('a browser check takes its own lock, so it never waits for a code check', async () => {
  const { f, e, store } = await setup();
  try {
    const code = await acquireProjectLock(store, f.project.id);
    const browser = await acquireProjectLock(store, f.project.id, 'browser');
    await assert.rejects(acquireProjectLock(store, f.project.id), /active operation/);
    await assert.rejects(acquireProjectLock(store, f.project.id, 'browser'), /active operation/);
    await code();
    await browser();
  } finally {
    await e.dispose();
  }
});
