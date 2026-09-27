import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { Baseline, Project, RunManifest } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { defaultOverrides } from '../packages/estimation/src/index.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

async function lifecycleFixture() {
  const f = await fixture();
  const store = new Store(path.join(f.root, 'data'));
  const runtime = new FixtureRuntime(f);
  const engine = new Engine(store, runtime);
  const prepared = await engine.prepare(f.project);
  await engine.wait(prepared.runId);
  const baseline = await engine.approve(f.project.id, prepared.runId, f.product);
  const folder = store.project(f.project.id);
  return {
    ...f,
    store,
    runtime,
    engine,
    prepared,
    baseline,
    folder,
    close: async () => {
      await engine.dispose();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}

void test('idle project updates preserve runtime selection and reset only history-dependent overrides', async () => {
  const f = await lifecycleFixture();
  try {
    assert.equal((await f.engine.projects()).length, 1);
    assert.deepEqual(await f.engine.candidate(f.project.id, f.prepared.runId), f.product);
    await f.engine.updateRuntime(f.project.id, {
      provider: 'claude',
      auth: 'apiKey',
      model: 'synthetic',
    });
    assert.deepEqual((await f.engine.state(f.project.id)).project?.runtime, {
      provider: 'claude',
      auth: 'apiKey',
      model: 'synthetic',
    });
    const overrides = {
      ...defaultOverrides(),
      requirementPoints: { 'REQ-1': 5 },
      comparisons: { 'REQ-1': ['old'] },
      historicalPoints: { old: 8 },
    };
    await atomic(path.join(f.folder, 'estimate-overrides.json'), overrides);
    await f.engine.updateSources(f.project.id, {
      contextConnectionIds: ['context'],
      history: null,
    });
    assert.deepEqual(await json(path.join(f.folder, 'estimate-overrides.json')), overrides);
    await f.engine.updateSources(f.project.id, {
      contextConnectionIds: [],
      history: {
        connectionId: 'history',
        sourceId: 'team',
        sourceLabel: 'Synthetic team',
        historyTool: 'read',
        sourceArgument: 'team',
      },
    });
    assert.deepEqual(await json(path.join(f.folder, 'estimate-overrides.json')), {
      ...overrides,
      comparisons: {},
      historicalPoints: {},
    });
    await assert.rejects(
      f.engine.applyEstimateOverrides(f.project.id, defaultOverrides()),
      /Generate an estimate/,
    );
    assert.throws(() => f.engine.cancel('inactive'), /not active/);
    assert.throws(() => f.engine.answer('inactive', 'question', 'answer'), /no longer/);
    await f.engine.wait('inactive');
    await assert.rejects(f.engine.resume(f.project.id, f.prepared.runId), /finished/);
    await assert.rejects(f.engine.updateRuntime(f.project.id, { provider: 'invalid' } as any));
    // A rejected update must release the lock so a valid explicit update can follow.
    await f.engine.updateRuntime(f.project.id, f.project.runtime);
    const project = await json<Project>(path.join(f.folder, 'project.json'));
    await atomic(path.join(f.folder, 'project.json'), { ...project, context: 'Changed intent' });
    await assert.rejects(f.engine.approve(f.project.id, f.prepared.runId, f.product), /stale/);
    await assert.rejects(f.engine.report(f.project.id), /Review/);
  } finally {
    await f.close();
  }
});

void test('accepted report identity and baseline guards reject corrupt stored state', async () => {
  const f = await lifecycleFixture();
  try {
    const reportRun = await f.engine.report(f.project.id);
    await f.engine.wait(reportRun.runId);
    await assert.rejects(f.engine.approve(f.project.id, reportRun.runId, f.product), /No pending/);
    await assert.rejects(f.engine.resume(f.project.id, reportRun.runId), /finished/);
    await assert.rejects(f.engine.evidence(f.project.id, reportRun.runId, 99, 0), /not found/);
    await assert.rejects(
      f.engine.export(f.project.id, reportRun.runId, 'markdown', true),
      /No accepted estimation/,
    );
    const file = path.join(f.store.run(f.project.id, reportRun.runId), 'manifest.json');
    const manifest = await json<RunManifest>(file);
    const withoutBaseline = { ...manifest };
    delete withoutBaseline.baseline;
    await atomic(file, withoutBaseline);
    await assert.rejects(f.engine.getReport(f.project.id), /Missing report baseline/);
    await atomic(file, { ...manifest, projectId: 'other' });
    await assert.rejects(f.engine.getReport(f.project.id), /identity mismatch/);
    await assert.rejects(f.engine.resume(f.project.id, reportRun.runId), /identity mismatch/);
    await atomic(file, manifest);
    assert.equal((await f.engine.getReport(f.project.id)).id, reportRun.runId);
  } finally {
    await f.close();
  }
});

void test('estimate overrides retain suggested values and stale pointers cannot be exported', async () => {
  const f = await lifecycleFixture();
  try {
    assert.equal(await f.engine.getEstimate(f.project.id), null);
    const report = await f.engine.report(f.project.id);
    await f.engine.wait(report.runId);
    const estimate = await f.engine.estimate(f.project.id); // Resolve the current report pointer.
    await f.engine.wait(estimate.runId);
    const overrides = {
      ...defaultOverrides(),
      requirementPoints: { 'REQ-1': 8 },
      remainingPoints: { 'REQ-1': 5 },
      durations: { 'REQ-1': 7 },
      comparisons: { 'REQ-1': [] },
      manualWeeklyRate: 5,
    };
    const revised = await f.engine.applyEstimateOverrides(f.project.id, overrides);
    assert.notEqual(revised.id, estimate.runId);
    assert.equal(revised.requirements[0]?.points, 8);
    assert.equal(revised.requirements[0]?.suggestedPoints, 2);
    assert.equal(revised.requirements[0]?.remainingPoints, 5);
    assert.equal(revised.requirements[0]?.durationDays, 7);
    assert.equal(revised.requirements[0]?.pointsOverridden, true);
    assert.equal(revised.requirements[1]?.pointsOverridden, false);
    assert.deepEqual(await json(path.join(f.folder, 'estimate-overrides.json')), overrides);
    assert.equal((await f.engine.getEstimate(f.project.id))?.id, revised.id);
    await atomic(path.join(f.folder, 'latest.json'), { id: 'newer-report' });
    assert.equal(await f.engine.getEstimate(f.project.id), null);
    await atomic(path.join(f.folder, 'latest.json'), { id: report.runId });
    await atomic(path.join(f.folder, 'baseline.json'), { ...f.baseline, id: 'newer-baseline' });
    assert.equal(await f.engine.getEstimate(f.project.id), null);
    await atomic(path.join(f.folder, 'baseline.json'), f.baseline);
    await f.engine.updateSources(f.project.id, {
      contextConnectionIds: ['new-source'],
      history: null,
    });
    assert.equal(await f.engine.getEstimate(f.project.id), null);
    await assert.rejects(
      f.engine.export(f.project.id, report.runId, 'json', true),
      /No accepted estimation/,
    );
    assert.equal((await f.engine.getReport(f.project.id)).id, report.runId);
  } finally {
    await f.close();
  }
});

void test('empty, corrupt, and abandoned project state is handled without automatically running providers', async () => {
  const f = await lifecycleFixture();
  try {
    const empty = new Engine(new Store(path.join(f.root, 'empty')), f.runtime);
    try {
      assert.deepEqual(await empty.projects(), []);
      assert.deepEqual(await empty.state('missing'), { project: null, baseline: null, runs: [] });
    } finally {
      await empty.dispose();
    }
    const count = f.runtime.calls.length;
    await writeFile(
      path.join(f.folder, 'active.lock'),
      JSON.stringify({ pid: 2147483647, token: 'abandoned' }),
    );
    await f.engine.updateRuntime(f.project.id, f.project.runtime);
    assert.equal(
      f.runtime.calls.length,
      count,
      'recovering a dead lock must not trigger provider execution',
    );
    await mkdir(path.join(f.store.root, 'projects', 'empty-project'));
    assert.equal((await f.engine.projects()).length, 1);
    await mkdir(path.join(f.folder, 'runs', 'empty-run'));
    assert.equal((await f.engine.history(f.project.id)).length, 1);
    const saved = await readFile(path.join(f.folder, 'project.json'), 'utf8');
    await writeFile(path.join(f.folder, 'project.json'), '{broken');
    await assert.rejects(f.engine.projects(), SyntaxError);
    await assert.rejects(f.engine.updateRuntime(f.project.id, f.project.runtime));
    await writeFile(path.join(f.folder, 'project.json'), saved);
    const baseline = await json<Baseline>(path.join(f.folder, 'baseline.json'));
    assert.deepEqual(baseline, f.baseline);
  } finally {
    await f.close();
  }
});

void test('standalone estimate overrides preserve historical suggestions and derive durations from selected comparisons', async () => {
  const f = await lifecycleFixture();
  try {
    const run = await f.engine.estimate(f.project.id);
    await f.engine.wait(run.runId);
    const original = await f.engine.getEstimate(f.project.id);
    assert.ok(original);
    assert.equal(original.reportId, null);
    // Synthetic accepted history exercises recomputation without a hosted account or provider call.
    const history = [1, 3, 5].map((days, index) => ({
      connectionId: 'synthetic-history',
      sourceId: 'synthetic-team',
      id: `history-${index}`,
      identifier: `FIXTURE-${index}`,
      title: 'Synthetic comparable work',
      description: '',
      startedAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-06T00:00:00.000Z',
      observedCalendarDays: days,
      size: 'S',
      points: 2,
      workType: 'integration',
      scopeShape: 'bounded_change',
    }));
    const originalFile = path.join(f.folder, 'estimates', `${original.id}.json`);
    await atomic(originalFile, { ...original, history });
    const saved = await readFile(originalFile, 'utf8');
    const calls = f.runtime.calls.length;
    const revised = await f.engine.applyEstimateOverrides(f.project.id, {
      ...defaultOverrides(),
      historicalPoints: { 'history-0': 3 },
      comparisons: { 'REQ-1': history.map((issue) => issue.id) },
    });
    assert.equal(revised.reportId, null);
    assert.equal(revised.history[0]?.points, 3);
    assert.equal(revised.history[1]?.points, 2);
    assert.equal(revised.requirements[0]?.durationDays, 3);
    assert.equal(revised.requirements[0]?.suggestedDurationDays, 3);
    assert.equal(revised.requirements[0]?.durationOverridden, false);
    assert.deepEqual(
      revised.requirements[0]?.comparisonOverrides,
      history.map((issue) => issue.id),
    );
    assert.equal(f.runtime.calls.length, calls, 'manual recomputation must not invoke a provider');
    assert.equal(
      await readFile(originalFile, 'utf8'),
      saved,
      'previous accepted snapshots are immutable',
    );
  } finally {
    await f.close();
  }
});
