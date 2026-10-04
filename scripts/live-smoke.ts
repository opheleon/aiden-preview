import path from 'node:path';

import type { RunManifest } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { Runtimes } from '../packages/runtimes/src/index.js';
import { fixture } from '../tests/helpers.js';
const provider = process.argv[2] === 'claude' ? 'claude' : 'codex';
const auth = process.argv.includes('--api-key') ? 'apiKey' : 'subscription';
const f = await fixture();
f.project.runtime = {
  provider,
  auth,
  ...(process.env.AIDEN_SMOKE_MODEL ? { model: process.env.AIDEN_SMOKE_MODEL } : {}),
};
const store = new Store(path.join(f.root, 'aiden-data'));
const runtime = new Runtimes(path.join(store.root, 'providers'));
const e = new Engine(store, runtime, (event) => {
  console.log(
    JSON.stringify({
      type: event.type,
      stage: event.stage,
      message: event.message,
      runId: event.runId,
    }),
  );
  // Calls never block a run: an open question is logged with its assumption and the run proceeds.
  if (event.activity?.kind === 'ask') console.log(JSON.stringify({ ask: event.activity.summary }));
});
try {
  const diagnostics = await runtime.diagnostics();
  console.log(JSON.stringify({ diagnostics }));
  const d = diagnostics.find((d) => d.provider === provider);
  if (auth === 'subscription' ? !d?.subscription : !d?.apiKey) {
    console.log(
      JSON.stringify({
        status: 'blocked',
        reason: `${provider} ${auth} credentials unavailable. No live model execution occurred.`,
      }),
    );
    process.exitCode = 2;
  } else {
    const prep = await e.prepare(f.project);
    await e.wait(prep.runId);
    const prepared = await json<RunManifest>(
      path.join(store.run(f.project.id, prep.runId), 'manifest.json'),
    );
    if (prepared.status !== 'review') throw new Error(prepared.error ?? 'Prepare failed');
    const candidate = await e.candidate(f.project.id, prep.runId);
    if (candidate.requirements.length !== 2)
      throw new Error('Smoke review rejected unexpected requirement count.');
    await e.approve(f.project.id, prep.runId, candidate);
    const run = await e.report(f.project.id);
    await e.wait(run.runId);
    const manifest = await json<RunManifest>(
      path.join(store.run(f.project.id, run.runId), 'manifest.json'),
    );
    if (manifest.status !== 'completed') throw new Error(manifest.error ?? 'Report failed');
    const report = await e.getReport(f.project.id, run.runId);
    if (!report.assessments.some((a) => a.evidence.length))
      throw new Error('Live smoke test failed: no inspected evidence was returned.');
    await atomic(path.join(f.root, 'live-report.json'), report);
    console.log(
      JSON.stringify({
        status: 'completed',
        provider,
        report: path.join(f.root, 'live-report.json'),
        assessments: report.assessments.map((a) => ({
          id: a.requirementId,
          status: a.status,
          deviation: a.deviation,
        })),
      }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await e.dispose();
}
