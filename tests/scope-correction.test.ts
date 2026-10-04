import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { Baseline } from '../packages/contracts/src/index.js';
import { answerCall, readCalls } from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import { answerAndLook, startLook } from '../packages/core/src/look.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const wrong = 'Remove the Projects panel from the middle of the screen.';
const corrected =
  'Remove the redundant Projects text label from the header; keep the Projects panel and navigation button.';
const answer = 'The project panel stays. Remove only the redundant Projects text at the top.';

/** Wait for a complete corrected report and automatic sizing, with a bounded failure. */
async function settled(engine: Engine, projectId: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const runs = await engine.history(projectId);
    if (
      runs.some((r) => r.kind === 'estimate' && r.status === 'completed') &&
      !engine.isBusy(projectId)
    )
      return;
    const failed = runs.find((r) => r.reason === 'answer' && r.status === 'failed');
    assert.equal(failed, undefined, failed?.error);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Corrected workflow did not complete.');
}

for (const timing of ['idle', 'busy', 'restart', 'legacy-restart'] as const) {
  void test(`panel-to-header correction reaches scope, assessment and subsequent verification: ${timing}`, async () => {
    const f = await fixture();
    f.project.context = 'Remove the Projects in the middle of the app.';
    f.product.requirements[0]!.text = wrong;
    const runtime = new FixtureRuntime(f);
    runtime.understanding = {
      ...f.product,
      requirements: f.product.requirements.map((r) => ({ ...r, edgeCases: [] })),
      calls: [
        {
          question: 'Remove or relocate the Projects panel?',
          assumption: 'Remove the panel.',
          options: [],
          owner: 'you',
          requirementId: 'REQ-1',
          edgeCaseId: null,
        },
      ],
    };
    const store = new Store(path.join(f.root, 'data'));
    const prompts: string[] = [];
    let engine = new Engine(store, {
      run: (request) => {
        prompts.push(request.prompt);
        return runtime.run(request);
      },
    });
    const browserScopes: Baseline[] = [];
    engine.verify = async () => {
      browserScopes.push((await engine.state(f.project.id)).baseline!);
      return { runId: 'synthetic-browser-boundary' };
    };
    try {
      const prepared = await engine.prepare(f.project, { autoAccept: true });
      await engine.wait(prepared.runId);
      const baselineFile = path.join(store.project(f.project.id), 'baseline.json');
      const original = await json<Baseline>(baselineFile);
      const call = (await readCalls(store, f.project.id))[0]!;
      await atomic(path.join(store.project(f.project.id), 'verification.json'), {
        url: 'http://localhost:4321/',
      });
      runtime.understanding = {
        ...runtime.understanding,
        requirements: [
          { id: 'REQ-1', text: corrected, edgeCases: [] },
          { ...f.product.requirements[1], edgeCases: [] },
        ],
        calls: [],
      };
      if (timing === 'busy') {
        runtime.pause = true;
        const active = await startLook(engine, f.project.id, 'you');
        await answerAndLook(engine, f.project.id, call.id, answer);
        engine.cancel(active.runId);
        runtime.pause = false;
      } else if (timing === 'idle') {
        await answerAndLook(engine, f.project.id, call.id, answer);
      } else {
        // Reconstruct only persisted state, as after process exit. No pending-answer WeakMap entry.
        if (timing === 'legacy-restart') {
          delete original.decisionsHash;
          original.reviewedAt = '2020-01-01T00:00:00.000Z';
          await atomic(baselineFile, original);
        }
        await answerCall(store, f.project.id, call.id, answer);
        const provider = engine.runtime;
        const verify = engine.verify.bind(engine);
        await engine.dispose();
        engine = new Engine(store, provider);
        engine.verify = verify;
        await startLook(engine, f.project.id, 'you');
      }
      await settled(engine, f.project.id);
      const baseline = (await engine.state(f.project.id)).baseline!;
      assert.notEqual(baseline.id, original.id);
      assert.equal(baseline.product.requirements[0]?.text, corrected);
      assert.deepEqual(baseline.product.requirements[1], original.product.requirements[1]);
      assert.ok(prompts.some((p) => p.includes('Establish a minimal') && p.includes(answer)));
      const report = await engine.getReport(f.project.id);
      assert.equal(report.baselineId, baseline.id);
      assert.equal(report.baseline.requirements[0]?.text, corrected);
      assert.equal(browserScopes.length, 0, 'Scope changes do not launch local checks');
      await engine.verify(f.project.id, 'https://beta.example.com');
      assert.equal(browserScopes.at(-1)?.id, baseline.id);
      assert.equal(browserScopes.at(-1)?.product.requirements[0]?.text, corrected);
      assert.equal(
        (await readCalls(store, f.project.id)).filter(
          (c) => c.status === 'open' && c.kind === 'decision',
        ).length,
        0,
      );
      assert.equal(
        (await engine.history(f.project.id)).filter(
          (r) => r.kind === 'prepare' && r.reason === 'answer',
        ).length,
        1,
      );
    } finally {
      await engine.dispose();
    }
  });
}
