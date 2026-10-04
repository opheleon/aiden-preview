import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { RunManifest } from '../packages/contracts/src/index.js';
import { readActivity } from '../packages/core/src/activity.js';
import { askWhy, explainEntry, readChat } from '../packages/core/src/ask-why.js';
import { Engine } from '../packages/core/src/engine.js';
import { startLook } from '../packages/core/src/look.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

/** A project with what done means committed and one finished look. */
async function lookedAt() {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime);
  e.discover = { fetch: () => Promise.reject(new Error('connection refused')) };
  const p = await e.prepare(f.project, { autoAccept: true, reason: 'intent' });
  await e.wait(p.runId);
  const look = await startLook(e, f.project.id, 'you');
  await e.wait(look.runId);
  // The automatic estimate is a separate model run; finish it before asserting chat inputs.
  for (let attempt = 0; attempt < 100; attempt++) {
    const estimate = (await e.history(f.project.id)).find((run) => run.kind === 'estimate');
    if (estimate) {
      await e.wait(estimate.id);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { f, runtime, store, e, prepareId: p.runId, lookId: look.runId };
}

void test('a logged reason answers Why? at once, without asking the model', async () => {
  const { f, runtime, store, e, lookId } = await lookedAt();
  try {
    const line = (await readActivity(store, f.project.id)).find(
      (entry) => entry.runId === lookId && entry.kind === 'find',
    )!;
    const before = runtime.calls.length;
    const chat = await explainEntry(e, f.project.id, lookId, line);
    assert.equal(runtime.calls.length, before, 'no model turn for a recorded reason');
    assert.deepEqual(
      chat.map((m) => [m.from, m.text, m.source]),
      [
        ['you', `Why: ${line.summary}`, undefined],
        ['aiden', line.reason, 'log'],
      ],
    );
    assert.deepEqual(await readChat(store, f.project.id, lookId), chat);
  } finally {
    await e.dispose();
  }
});

void test('other questions are answered from the run record with the project runtime and no tools', async () => {
  const { f, runtime, e, lookId, prepareId } = await lookedAt();
  try {
    const chat = await askWhy(e, f.project.id, lookId, '  Why is REQ-2 not built?  ');
    assert.equal(runtime.calls.at(-1), 'ask-why');
    const input = runtime.inputs.at(-1) as {
      question: string;
      run: { kind: string; startedBecause: string };
      log: { summary: string }[];
      outcome: { findings: { requirementId: string; evidence: string[] }[] };
      earlier: unknown[];
    };
    assert.equal(input.question, 'Why is REQ-2 not built?');
    assert.deepEqual(input.run.kind, 'report');
    assert.equal(input.run.startedBecause, 'you');
    assert.ok(input.log.some((l) => /REQ-2/.test(l.summary)));
    assert.match(input.outcome.findings[0]!.evidence[0]!, /app\.txt:1-2/);
    assert.deepEqual(input.earlier, []);
    assert.deepEqual(
      chat.map((m) => [m.from, m.source]),
      [
        ['you', undefined],
        ['aiden', 'model'],
      ],
    );
    await askWhy(e, f.project.id, lookId, 'And REQ-1?');
    assert.equal((runtime.inputs.at(-1) as { earlier: unknown[] }).earlier.length, 2);
    // A rebuilt line from saved history has no recorded reason, so the model answers it.
    const calls = runtime.calls.length;
    await explainEntry(e, f.project.id, prepareId, {
      at: new Date().toISOString(),
      summary: 'Wrote the requirements from your goal.',
    });
    assert.equal(runtime.calls.length, calls + 1);
    assert.equal(runtime.calls.at(-1), 'ask-why', 'a line without a reason goes to the model');
  } finally {
    await e.dispose();
  }
});

void test('empty questions, unusable answers, and foreign runs are refused', async () => {
  const { f, runtime, store, e, lookId } = await lookedAt();
  try {
    await assert.rejects(askWhy(e, f.project.id, lookId, '   '), /Ask a question/);
    runtime.whyAnswer = null;
    await assert.rejects(askWhy(e, f.project.id, lookId, 'Why?'), /could not answer/);
    assert.deepEqual(await readChat(store, f.project.id, lookId), [], 'nothing saved on failure');
    await assert.rejects(askWhy(e, 'other-project', lookId, 'Why?'));
  } finally {
    await e.dispose();
  }
});

void test('questions about a browser check see its plan and steps; a failed run and provider errors are handled', async () => {
  const { f, runtime, store, e, lookId } = await lookedAt();
  try {
    const look = await json<RunManifest>(
      path.join(store.run(f.project.id, lookId), 'manifest.json'),
    );
    const verify = { ...look, id: 'verify-run', kind: 'verify' as const };
    await atomic(path.join(store.run(f.project.id, 'verify-run'), 'manifest.json'), verify);
    await atomic(path.join(store.run(f.project.id, 'verify-run'), 'verification', 'results.json'), {
      runId: 'verify-run',
      triage: [
        { requirementId: 'REQ-1', edgeCaseId: null, method: 'app', persona: null, reason: 'x' },
      ],
      criteria: [
        {
          requirementId: 'REQ-1',
          verdict: 'fail',
          reason: null,
          explanation: 'Synthetic failure',
          expected: 'A list',
          observed: 'Nothing',
          decisiveAttempt: 1,
          attempts: [
            {
              attempt: 1,
              steps: [{ index: 1, action: 'Open', result: 'Blank', atMs: 42000 }],
            },
          ],
        },
      ],
    });
    await askWhy(e, f.project.id, 'verify-run', 'Why broken?');
    const input = runtime.inputs.at(-1) as {
      outcome: { plan: unknown[]; checks: { steps: { atMs: number }[]; edgeCaseId: null }[] };
    };
    assert.equal(input.outcome.plan.length, 1);
    assert.deepEqual(input.outcome.checks[0]!.steps, [
      { atMs: 42000, action: 'Open', result: 'Blank' },
    ]);
    assert.equal(input.outcome.checks[0]!.edgeCaseId, null);

    await atomic(path.join(store.run(f.project.id, 'failed-run'), 'manifest.json'), {
      ...look,
      id: 'failed-run',
      status: 'failed',
      error: 'Synthetic failure',
    });
    await askWhy(e, f.project.id, 'failed-run', 'What went wrong?');
    const failed = runtime.inputs.at(-1) as { outcome: unknown; run: { error: string } };
    assert.equal(failed.outcome, null);
    assert.equal(failed.run.error, 'Synthetic failure');

    runtime.whyAnswer = 'x'.repeat(1500);
    const long = await askWhy(e, f.project.id, 'failed-run', 'Long?');
    assert.ok(long.at(-1)!.text.length <= 2000);
    const original = runtime.run.bind(runtime);
    runtime.run = () => Promise.reject(new Error('Provider unavailable'));
    await assert.rejects(askWhy(e, f.project.id, lookId, 'Why?'), /Provider unavailable/);
    runtime.run = original;
  } finally {
    await e.dispose();
  }
});
