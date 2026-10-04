import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { CallDraft } from '../packages/contracts/src/index.js';
import {
  answerCall,
  answeredDecisions,
  readCalls,
  recordCall,
  replaceOpenDecisions,
  settleAppUrlCalls,
} from '../packages/core/src/calls.js';
import { Store } from '../packages/core/src/storage.js';

const projectId = 'calls-project';

/** A decision draft with the given question. */
const draft = (question: string, extra: Partial<CallDraft> = {}): CallDraft => ({
  requirementId: null,
  edgeCaseId: null,
  question,
  options: [],
  assumption: `Assuming the default for: ${question}`,
  owner: 'you',
  ...extra,
});

/** Run a test against a throwaway store. */
async function withStore(fn: (store: Store) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-calls-'));
  try {
    await fn(new Store(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('a new project has no calls, and a re-asked open question is not duplicated', () =>
  withStore(async (store) => {
    assert.deepEqual(await readCalls(store, projectId), []);
    const first = await recordCall(store, projectId, draft('Notify attendees?'), 'decision', 'r1');
    assert.equal(first.created, true);
    assert.equal(first.call.status, 'open');
    const again = await recordCall(
      store,
      projectId,
      draft('  notify   ATTENDEES? '),
      'decision',
      'r2',
    );
    assert.equal(again.created, false);
    assert.equal(again.call.id, first.call.id);
    const url = await recordCall(store, projectId, draft('Where is the app?'), 'app-url', 'r1');
    const url2 = await recordCall(store, projectId, draft('Which server?'), 'app-url', 'r2');
    assert.equal(url2.call.id, url.call.id, 'only one app-url call is open at a time');
    assert.equal((await readCalls(store, projectId)).length, 2);
  }));

void test('concurrent records in one worker never lose a call', () =>
  withStore(async (store) => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        recordCall(store, projectId, draft(`Question ${i}`), 'decision', 'r1'),
      ),
    );
    assert.equal((await readCalls(store, projectId)).length, 12);
  }));

void test('rewriting scope keeps re-proposed and same-run calls and drops the rest', () =>
  withStore(async (store) => {
    const kept = await recordCall(store, projectId, draft('Keep me?'), 'decision', 'old');
    const dropped = await recordCall(
      store,
      projectId,
      draft('Drop me?', { blocking: false }),
      'decision',
      'old',
    );
    const sameRun = await recordCall(store, projectId, draft('Asked by tool?'), 'decision', 'new');
    const app = await recordCall(store, projectId, draft('Where?'), 'app-url', 'old');
    const created = await replaceOpenDecisions(
      store,
      projectId,
      [draft('keep me?'), draft('Brand new?')],
      'new',
    );
    assert.deepEqual(
      created.map((c) => c.question),
      ['Brand new?'],
    );
    const byId = new Map((await readCalls(store, projectId)).map((c) => [c.id, c.status]));
    assert.equal(byId.get(kept.call.id), 'open');
    assert.equal(byId.get(dropped.call.id), 'dropped');
    assert.equal(byId.get(sameRun.call.id), 'open');
    assert.equal(byId.get(app.call.id), 'open', 'app-url calls are not scope decisions');
  }));

void test('answers are recorded once and become prior answers for later stages', () =>
  withStore(async (store) => {
    const { call } = await recordCall(
      store,
      projectId,
      draft('Reminder lead time?', { requirementId: 'REQ-2', edgeCaseId: 'E1' }),
      'decision',
      'r1',
    );
    await assert.rejects(answerCall(store, projectId, call.id, '   '), /answer is required/);
    await assert.rejects(answerCall(store, projectId, 'missing', 'x'), /no longer open/);
    const answered = await answerCall(store, projectId, call.id, ' 15 minutes ');
    assert.equal(answered.status, 'answered');
    assert.equal(answered.answer, '15 minutes');
    assert.ok(answered.answeredAt);
    await assert.rejects(answerCall(store, projectId, call.id, 'again'), /no longer open/);
    assert.deepEqual(await answeredDecisions(store, projectId), [
      {
        question: 'Reminder lead time?',
        answer: '15 minutes',
        requirementId: 'REQ-2',
        edgeCaseId: 'E1',
      },
    ]);
  }));

void test('finding the app settles its open call, and nothing changes when none is open', () =>
  withStore(async (store) => {
    await settleAppUrlCalls(store, projectId, 'http://localhost:3000/');
    assert.deepEqual(await readCalls(store, projectId), []);
    await recordCall(store, projectId, draft('Where does your app run?'), 'app-url', 'r1');
    await settleAppUrlCalls(store, projectId, 'http://localhost:3000/');
    const [call] = await readCalls(store, projectId);
    assert.equal(call?.status, 'answered');
    assert.equal(call?.answer, 'http://localhost:3000/');
    assert.deepEqual(
      await answeredDecisions(store, projectId),
      [],
      'app addresses are not decisions',
    );
  }));

void test('settled calls beyond the cap are pruned oldest first; open calls are kept', () =>
  withStore(async (store) => {
    const first = await recordCall(store, projectId, draft('Oldest open'), 'decision', 'r0');
    for (let i = 0; i < 500; i++) {
      const { call } = await recordCall(store, projectId, draft(`Q${i}`), 'decision', 'r1');
      await answerCall(store, projectId, call.id, 'yes');
    }
    const calls = await readCalls(store, projectId);
    assert.equal(calls.length, 500);
    assert.ok(calls.some((c) => c.id === first.call.id));
    assert.ok(!calls.some((c) => c.question === 'Q0'));
  }));
