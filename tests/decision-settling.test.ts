import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { CallDraft, Product } from '../packages/contracts/src/index.js';
import { readRunLog } from '../packages/core/src/activity.js';
import { answerCall, readCalls, recordCall } from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import { prepareAndLook } from '../packages/core/src/look.js';
import { Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const product: Product = {
  overview: 'Synthetic link shortener',
  milestones: [],
  requirements: [1, 2].map((n) => ({ id: `REQ-${n}`, text: `Behavior ${n}` })),
  deliveryPlan: [1, 2].map((n) => ({
    id: `F-${n}`,
    title: `Feature ${n}`,
    outcome: `Outcome ${n}`,
    kind: 'feature',
    rationale: 'Synthetic feature',
    requirementIds: [`REQ-${n}`],
    dependsOn: [],
  })),
};

/** A blocking decision draft on one requirement. */
const blocker = (question: string, requirementId: string): CallDraft => ({
  requirementId,
  edgeCaseId: null,
  question,
  options: [],
  assumption: `Work waits for: ${question}`,
  owner: 'you',
  blocking: true,
});

/** Wait until the project has stayed free of active runs and operation locks for a while. */
async function idle(engine: Engine, projectId: string): Promise<void> {
  const lock = path.join(engine.store.project(projectId), 'active.lock');
  let quiet = 0;
  for (let i = 0; i < 1000 && quiet < 10; i++) {
    const runs = await engine.history(projectId);
    const busy = !runs.length || engine.isBusy(projectId) || existsSync(lock);
    quiet = busy ? 0 : quiet + 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (quiet < 10) throw new Error('Runs did not finish.');
}

void test('an answer lets the rewrite close a reworded duplicate, and omission alone never does', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const asked = blocker('Should links without an expiry expire after 30 days?', 'REQ-2');
  const understanding = (calls: CallDraft[], settledCalls: string[]) => ({
    ...product,
    repositories: [],
    requirements: product.requirements.map((r) => ({ ...r, edgeCases: [] })),
    calls,
    settledCalls,
  });
  runtime.understanding = understanding([asked], []);
  const engine = new Engine(new Store(path.join(f.root, 'data')), runtime);
  try {
    await prepareAndLook(engine, f.project, 'intent');
    await idle(engine, f.project.id);
    // A later check asks the same thing in other words on another requirement.
    const { call: duplicate } = await recordCall(
      engine.store,
      f.project.id,
      blocker('What default expiry policy applies?', 'REQ-1'),
      'decision',
      'check',
    );
    const original = (await readCalls(engine.store, f.project.id)).find(
      (c) => c.question === asked.question,
    )!;

    // Without a new answer or changed intent, a settled claim is ignored.
    runtime.understanding = understanding([], [duplicate.question, original.question]);
    await prepareAndLook(engine, f.project, 'intent');
    await idle(engine, f.project.id);
    let calls = await readCalls(engine.store, f.project.id);
    assert.deepEqual(
      calls.map((c) => c.status),
      ['open', 'open'],
    );

    await answerCall(engine.store, f.project.id, original.id, 'Never expire by default');
    await prepareAndLook(engine, f.project, 'answer');
    await idle(engine, f.project.id);
    calls = await readCalls(engine.store, f.project.id);
    assert.equal(calls.find((c) => c.id === duplicate.id)?.status, 'dropped');
    assert.equal(calls.find((c) => c.id === original.id)?.status, 'answered');
    const runs = await engine.history(f.project.id);
    const rewrite = runs.find((r) => r.kind === 'prepare' && r.reason === 'answer')!;
    const log = await readRunLog(engine.store, f.project.id, rewrite.id);
    assert.ok(
      log.some(
        (e) => e.summary === `Closed a question your answers already settle: ${duplicate.question}`,
      ),
    );
    const report = runs.find((r) => r.kind === 'report' && r.createdAt > rewrite.createdAt);
    assert.equal(report?.status, 'completed', report?.error);
    const assess = runtime.inputs[runtime.calls.lastIndexOf('assess')] as {
      baseline: Product;
      openDecisions: unknown[];
    };
    assert.deepEqual(assess.openDecisions, []);
    assert.deepEqual(
      assess.baseline.requirements.map((r) => r.id),
      ['REQ-1', 'REQ-2'],
    );
  } finally {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});
