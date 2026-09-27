import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { json, optionalJson, Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';
import { required } from './required.js';
void test('both provider configurations complete reviewed multi-repository report and export through one contract', async () => {
  for (const provider of ['codex', 'claude'] as const) {
    const f = await fixture();
    f.project.runtime = { provider, auth: provider === 'codex' ? 'subscription' : 'apiKey' };
    f.project.rootPath = f.root;
    f.project.discoveryWarnings = ['Fixture: a hidden folder was excluded from discovery.'];
    const runtime = new FixtureRuntime(f);
    const store = new Store(path.join(f.root, 'data'));
    const events: RunEvent[] = [];
    const e = new Engine(store, runtime, (event) => events.push(event));
    try {
      const p = await e.prepare(f.project);
      await e.wait(p.runId);
      assert.equal(events.at(-1)?.type, 'review');
      const b = await e.approve(f.project.id, p.runId, f.product);
      const run = await e.report(f.project.id);
      await e.wait(run.runId);
      assert.equal(events.at(-1)?.type, 'completed', JSON.stringify(events.at(-1)));
      const report = await e.getReport(f.project.id);
      assert.equal(report.baselineId, b.id);
      assert.equal(report.runtime.provider, provider);
      assert.ok(report.warnings.includes(required(f.project.discoveryWarnings[0])));
      assert.ok((await e.state(f.project.id)).project?.rootPath);
      assert.equal(report.assessments.length, 2);
      assert.equal(required(report.assessments[0]).deviation, true);
      assert.match(await e.export(f.project.id, run.runId, 'markdown'), /FIXTURE REPORT/);
      assert.equal(JSON.parse(await e.export(f.project.id, run.runId, 'json')).id, run.runId);
      assert.match((await e.evidence(f.project.id, run.runId, 0, 0)).text, /GET \/books/);
      assert.deepEqual(runtime.calls, ['understand', 'discover', 'assess', 'summary']);
    } finally {
      await e.dispose();
    }
  }
});
void test('invalid output gets two correction attempts and cannot replace accepted report; resume skips completed stages', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime);
  try {
    const p = await e.prepare(f.project);
    await e.wait(p.runId);
    await e.approve(f.project.id, p.runId, f.product);
    const good = await e.report(f.project.id);
    await e.wait(good.runId);
    runtime.invalid = true;
    const bad = await e.report(f.project.id);
    await e.wait(bad.runId);
    const m = await json<RunManifest>(
      path.join(store.run(f.project.id, bad.runId), 'manifest.json'),
    );
    assert.equal(m.status, 'failed');
    assert.match(m.error!, /two correction/);
    assert.equal((await e.getReport(f.project.id)).id, good.runId);
    assert.equal(runtime.calls.filter((s) => s === 'assess').length, 4);
    runtime.invalid = false;
    const discoveryCalls = runtime.calls.filter((s) => s === 'discover').length;
    await e.resume(f.project.id, bad.runId);
    await e.wait(bad.runId);
    assert.equal((await e.getReport(f.project.id)).id, bad.runId);
    assert.equal(runtime.calls.filter((s) => s === 'discover').length, discoveryCalls);
  } finally {
    await e.dispose();
  }
});
void test('clarifications are answered by identity; cancellation and project locks protect accepted state', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  runtime.clarification = true;
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime, (event) => {
    if (event.type === 'clarification') {
      assert.throws(() => e.answer('other', event.questionId!, 'yes'), /no longer/);
      e.answer(event.runId, event.questionId!, 'yes');
    }
  });
  try {
    const p = await e.prepare(f.project);
    await e.wait(p.runId);
    await e.approve(f.project.id, p.runId, f.product);
    runtime.pause = true;
    const r = await e.report(f.project.id);
    await assert.rejects(e.report(f.project.id), /active operation/);
    e.cancel(r.runId);
    await e.wait(r.runId);
    assert.equal(
      (await json<RunManifest>(path.join(store.run(f.project.id, r.runId), 'manifest.json')))
        .status,
      'cancelled',
    );
    assert.equal(await optionalJson(path.join(store.project(f.project.id), 'latest.json')), null);
  } finally {
    await e.dispose();
  }
});
void test('reviewed baseline identity and retired IDs are enforced', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime);
  try {
    let p = await e.prepare(f.project);
    await e.wait(p.runId);
    await e.approve(f.project.id, p.runId, f.product);
    p = await e.prepare({ ...f.project, context: 'Only list books now.' });
    await e.wait(p.runId);
    await e.approve(f.project.id, p.runId, {
      ...f.product,
      requirements: [required(f.product.requirements[0])],
    });
    p = await e.prepare({ ...f.project, context: 'Restore creation as a new obligation.' });
    await e.wait(p.runId);
    await assert.rejects(e.approve(f.project.id, p.runId, f.product), /Retired/);
    await assert.rejects(e.report(f.project.id), /Review/);
  } finally {
    await e.dispose();
  }
});

void test('unknown coverage stays separate from missing and deviations, and cancellation preserves the previous report', async () => {
  const f = await fixture();
  f.product.requirements.push({ id: 'REQ-3', text: 'The deployed service is available.' });
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime);
  try {
    const prep = await e.prepare(f.project);
    await e.wait(prep.runId);
    await e.approve(f.project.id, prep.runId, f.product);
    const good = await e.report(f.project.id);
    await e.wait(good.runId);
    const report = await e.getReport(f.project.id);
    assert.equal(required(report.assessments[2]).status, 'unknown');
    assert.equal(required(report.assessments[2]).deviation, false);
    assert.equal(report.deviations.length, 1);
    runtime.pause = true;
    const stopped = await e.report(f.project.id);
    e.cancel(stopped.runId);
    await e.wait(stopped.runId);
    assert.equal((await e.getReport(f.project.id)).id, good.runId);
    await assert.rejects(e.getReport(f.project.id, stopped.runId));
  } finally {
    await e.dispose();
  }
});
