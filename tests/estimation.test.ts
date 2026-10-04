import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { HistoryIssue, RequirementEstimate } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import {
  buildForecast,
  defaultOverrides,
  durationSummary,
} from '../packages/estimation/src/index.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const issue = (id: string, days: number, points = 2): HistoryIssue => ({
  connectionId: 'linear',
  sourceId: 'team-1',
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  description: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-02T00:00:00.000Z',
  observedCalendarDays: days,
  size: 'S',
  points,
  workType: 'integration',
  scopeShape: 'bounded_change',
});

void test('historical duration uses observed variation with no time conversion', () => {
  const history = [issue('1', 1), issue('2', 5), issue('3', 2), issue('4', 10), issue('5', 3)];
  assert.deepEqual(durationSummary(history), { count: 5, median: 3, p10: 1, p90: 10 });
});

void test('forecast counts only implemented requirements and withholds completion when coverage is unknown', () => {
  const requirements = [
    { requirementId: 'REQ-1', points: 2, remainingPoints: 0 },
    { requirementId: 'REQ-2', points: 3, remainingPoints: null },
  ] as RequirementEstimate[];
  const report = {
    assessments: [
      { requirementId: 'REQ-1', status: 'implemented' },
      { requirementId: 'REQ-2', status: 'unknown' },
    ],
  } as any;
  const overrides = { ...defaultOverrides(), manualWeeklyRate: 5, targetDate: '2026-03-20' };
  const forecast = buildForecast({
    requirements,
    report,
    history: [],
    historyComplete: false,
    overrides,
    referenceDate: '2026-03-09',
  });
  assert.equal(forecast.implementedPoints, 2);
  assert.equal(forecast.implementedPercent, null);
  assert.equal(forecast.remainingPoints, null);
  assert.equal(forecast.forecastFinish, null);
});

void test('forecast counts shared work once across requirements', () => {
  const shared = (id: string) =>
    ({
      requirementId: id,
      points: 3,
      remainingPoints: 3,
      original: {
        workItems: [{ id: `${id}-shared`, text: 'Shared migration', sharedKey: 'migration' }],
      },
      remaining: {
        workItems: [{ id: `${id}-shared`, text: 'Shared migration', sharedKey: 'migration' }],
      },
    }) as any;
  const requirements = [shared('REQ-1'), shared('REQ-2')];
  const report = {
    assessments: [
      { requirementId: 'REQ-1', status: 'missing' },
      { requirementId: 'REQ-2', status: 'missing' },
    ],
  } as any;
  const forecast = buildForecast({
    requirements,
    report,
    history: [],
    historyComplete: false,
    overrides: { ...defaultOverrides(), manualWeeklyRate: 3 },
    referenceDate: '2026-03-09',
  });
  assert.equal(forecast.totalPoints, 3);
  assert.equal(forecast.remainingPoints, 3);
  assert.equal(forecast.remainingWorkingDays, null);
  assert.equal(forecast.weeklyRate, null);
  assert.equal(forecast.forecastFinish, null);
});

void test('model estimates use one artifact contract and remain independently publishable', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const engine = new Engine(new Store(path.join(f.root, 'data')), runtime);
  try {
    const prep = await engine.prepare(f.project);
    await engine.wait(prep.runId);
    const baseline = await engine.approve(f.project.id, prep.runId, f.product);
    const reportRun = await engine.report(f.project.id);
    await engine.wait(reportRun.runId);
    const estimateRun = await engine.estimate(f.project.id, reportRun.runId);
    await engine.wait(estimateRun.runId);
    const estimate = await engine.getEstimate(f.project.id);
    assert.equal(estimate?.baselineId, baseline.id);
    assert.equal(estimate?.reportId, reportRun.runId);
    assert.ok(estimate);
    const { estimationMarkdown } = await import('../packages/reporting/src/index.js');
    const legacy = {
      ...estimate,
      estimatorVersion: '1' as const,
      requirements: estimate.requirements.map((row) => ({
        ...row,
        durationDays: 123,
        durationOverridden: true,
      })),
    };
    assert.doesNotMatch(estimationMarkdown(legacy), /123 calendar days/);
    assert.match(estimationMarkdown(legacy), /Historical median: unavailable/);

    assert.deepEqual(
      estimate?.requirements.map((row) => row.points),
      [2, 3],
    );
    assert.deepEqual(
      estimate?.requirements.map((row) => row.remainingPoints),
      [2, 3],
    );
    assert.match(
      await engine.export(f.project.id, reportRun.runId, 'markdown', true),
      /## Estimation/,
    );
    const bundle = JSON.parse(await engine.export(f.project.id, reportRun.runId, 'json', true));
    assert.equal(bundle.estimation.id, estimateRun.runId);
    assert.ok(runtime.calls.includes('estimate-original'));
    assert.ok(runtime.calls.includes('estimate-remaining'));
  } finally {
    await engine.dispose();
  }
});

void test('cancelled estimation preserves the previous accepted estimation artifact', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const engine = new Engine(new Store(path.join(f.root, 'data')), runtime);
  try {
    const prep = await engine.prepare(f.project);
    await engine.wait(prep.runId);
    await engine.approve(f.project.id, prep.runId, f.product);
    const reportRun = await engine.report(f.project.id);
    await engine.wait(reportRun.runId);
    const accepted = await engine.estimate(f.project.id, reportRun.runId);
    await engine.wait(accepted.runId);
    runtime.pauseEstimate = true;
    const stopped = await engine.estimate(f.project.id, reportRun.runId, true);
    engine.cancel(stopped.runId);
    await engine.wait(stopped.runId);
    assert.equal((await engine.getEstimate(f.project.id))?.id, accepted.runId);
  } finally {
    await engine.dispose();
  }
});

void test('estimation uses approved context tools but rejects interactive clarification and preserves source receipts', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { hash, json } = await import('../packages/core/src/storage.js');
  const f = await fixture();
  f.project.sources = { contextConnectionIds: ['context'], history: null };
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const progress: string[] = [];
  const engine = new Engine(store, runtime, (event) => {
    if (event.message) progress.push(event.message);
  });
  let reads = 0;
  engine.integrations.call = (connectionId, tool, args) => {
    reads++;
    const result = { content: [{ type: 'text' as const, text: 'Synthetic context only.' }] };
    return Promise.resolve({
      result,
      receipt: {
        connectionId,
        tool,
        argumentsHash: hash(args),
        resultHash: hash(result),
        calledAt: new Date().toISOString(),
        recordCount: 1,
      },
    });
  };
  const execute = runtime.run.bind(runtime);
  runtime.run = async (request) => {
    if (request.prompt.includes('software estimator')) {
      const client = new Client({ name: 'synthetic-estimation', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(request.tools.url), {
            requestInit: { headers: { Authorization: `Bearer ${request.tools.token}` } },
          }) as import('@modelcontextprotocol/sdk/shared/transport.js').Transport,
        );
        assert.equal(
          (await client.callTool({ name: 'repo_inventory', arguments: {} })).isError,
          undefined,
        );
        assert.equal(
          (
            await client.callTool({
              name: 'request_clarification',
              arguments: { question: 'Synthetic question', assumption: 'Synthetic assumption' },
            })
          ).isError,
          true,
        );
        assert.equal(
          (
            await client.callTool({
              name: 'external_read',
              arguments: { connectionId: 'context', tool: 'read', arguments: {} },
            })
          ).isError,
          undefined,
        );
      } finally {
        await client.close();
      }
    }
    return execute(request);
  };
  try {
    const prep = await engine.prepare(f.project);
    await engine.wait(prep.runId);
    await engine.approve(f.project.id, prep.runId, f.product);
    const estimated = await engine.estimate(f.project.id);
    await engine.wait(estimated.runId);
    assert.equal((await engine.getEstimate(f.project.id))?.id, estimated.runId);
    assert.equal(reads, 1);
    assert.ok(progress.includes('Listed the repositories and their branches'));
    const receipts = await json<{ connectionId: string }[]>(
      path.join(store.run(f.project.id, estimated.runId), 'external-reads.json'),
    );
    assert.equal(receipts[0]?.connectionId, 'context');
  } finally {
    await engine.dispose();
  }
});
