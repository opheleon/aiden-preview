import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type Baseline,
  type RemainingEstimate,
  ReportSchema,
  type RunManifest,
} from '../packages/contracts/src/index.js';
import {
  buildRequirementEstimates,
  historicalEstimates,
  originalEstimates,
  remainingEstimates,
} from '../packages/core/src/estimation-stages.js';
import type { ModelStage } from '../packages/core/src/model-stage.js';
import { defaultOverrides } from '../packages/estimation/src/index.js';

const baseline: Baseline = {
  id: 'baseline',
  projectId: 'project',
  contextHash: 'synthetic',
  product: {
    overview: 'Synthetic scope',
    requirements: [{ id: 'REQ-1', text: 'Synthetic requirement' }],
    milestones: [],
  },
  reviewedAt: '2026-09-26T00:00:00Z',
  retiredIds: [],
};
const complexity = {
  requirementId: 'REQ-1',
  size: 'S' as const,
  points: 2 as const,
  reasoning: 'Synthetic bounded work',
  workType: 'backend' as const,
  scopeShape: 'bounded_change' as const,
  workItems: [{ id: 'work', text: 'Implement synthetic work' }],
};
const remaining: RemainingEstimate = {
  requirementId: 'REQ-1',
  estimable: true,
  comparisonMatches: [],
  workType: 'backend',
  scopeShape: 'bounded_change',
  size: 'S',
  points: 2,
  reasoning: 'Synthetic unfinished work',
  workItems: [{ id: 'work', text: 'Finish synthetic work' }],
  unknowns: [],
};
const report = ReportSchema.parse({
  schemaVersion: '1.0',
  workflowVersion: '1',
  id: 'report',
  projectId: 'project',
  baselineId: 'baseline',
  generatedAt: '2026-09-26T00:00:00Z',
  runtime: { provider: 'codex', auth: 'subscription' },
  runtimeVersion: 'synthetic',
  baseline: baseline.product,
  snapshots: [],
  summary: 'Synthetic report',
  assessments: [
    {
      requirementId: 'REQ-1',
      status: 'missing',
      deviation: false,
      explanation: 'Synthetic missing work',
      evidence: [],
      remainingWork: [],
      unknowns: [],
    },
  ],
  deviations: [],
  risks: [],
  dependencies: [],
  unknowns: [],
  warnings: [],
  validation: 'structure-and-evidence-checked',
});
const run = { id: 'run', projectId: 'project' } as RunManifest;
function stageFor(value: unknown): ModelStage {
  return (_name, _schema, _input, validate) => Promise.resolve().then(() => validate(value));
}

void test('classification validators preserve exact requirement/history identity and the shared points rubric', async () => {
  assert.deepEqual(await originalEstimates(stageFor({ requirements: [complexity] }), baseline), [
    complexity,
  ]);
  await assert.rejects(
    originalEstimates(
      stageFor({ requirements: [{ ...complexity, requirementId: 'REQ-2' }] }),
      baseline,
    ),
    /exactly every/,
  );
  await assert.rejects(
    originalEstimates(stageFor({ requirements: [{ ...complexity, points: 3 }] }), baseline),
    /points must match/,
  );
  const rows = [
    {
      id: 'history',
      connectionId: 'connection',
      sourceId: 'source',
      identifier: 'H-1',
      title: 'Synthetic history',
      description: '',
      startedAt: null,
      completedAt: null,
      observedCalendarDays: null,
    },
  ];
  const classification = {
    id: 'history',
    size: 'S',
    points: 2,
    reasoning: 'Synthetic comparison',
    workType: 'backend',
    scopeShape: 'bounded_change',
  };
  assert.deepEqual(await historicalEstimates(stageFor({ issues: [classification] }), rows), [
    { ...rows[0], ...classification },
  ]);
  assert.deepEqual(await historicalEstimates(stageFor({}), []), []);
  await assert.rejects(historicalEstimates(stageFor({ issues: [] }), rows), /every retrieved/);
  await assert.rejects(
    historicalEstimates(stageFor({ issues: [{ ...classification, points: 3 }] }), rows),
    /shared rubric/,
  );
});

void test('remaining-work validation distinguishes implemented, unknown, missing, and contradictory evidence', async () => {
  const context = { emit: () => {} };
  const valid = await remainingEstimates(
    stageFor({ requirements: [remaining] }),
    baseline,
    report,
    context,
    run,
  );
  assert.deepEqual(valid.get('REQ-1'), remaining);
  assert.equal((await remainingEstimates(stageFor({}), baseline, null, context, run)).size, 0);
  const cases = [
    { status: 'implemented', row: remaining, pattern: /zero remaining/ },
    { status: 'unknown', row: remaining, pattern: /unknown assessment/ },
    { status: 'partial', row: { ...remaining, workItems: [] }, pattern: /concrete work items/ },
    {
      status: 'missing',
      row: { ...remaining, size: 'S', points: 3 },
      pattern: /shared size scale/,
    },
    { status: 'unknown', row: { ...remaining, estimable: false }, pattern: /unknown work cannot/ },
    { status: 'missing', row: { ...remaining, requirementId: 'REQ-2' }, pattern: /every reviewed/ },
  ] as const;
  for (const entry of cases) {
    const current = {
      ...report,
      assessments: report.assessments.map((assessment) => ({
        ...assessment,
        status: entry.status,
      })),
    };
    await assert.rejects(
      remainingEstimates(stageFor({ requirements: [entry.row] }), baseline, current, context, run),
      entry.pattern,
    );
  }
  const implemented = {
    ...report,
    assessments: report.assessments.map((assessment) => ({
      ...assessment,
      status: 'implemented' as const,
    })),
  };
  const finished = { ...remaining, size: null, points: 0, workItems: [] };
  assert.equal(
    (
      await remainingEstimates(
        stageFor({ requirements: [finished] }),
        baseline,
        implemented,
        context,
        run,
      )
    ).get('REQ-1')?.points,
    0,
  );
  const unknown = {
    ...report,
    assessments: report.assessments.map((assessment) => ({
      ...assessment,
      status: 'unknown' as const,
    })),
  };
  const uncertain = { ...remaining, estimable: false, size: null, points: null, workItems: [] };
  assert.equal(
    (
      await remainingEstimates(
        stageFor({ requirements: [uncertain] }),
        baseline,
        unknown,
        context,
        run,
      )
    ).get('REQ-1')?.points,
    null,
  );
});

void test('estimate construction preserves original suggestions while deriving and overriding comparable durations', () => {
  const history = [1, 3, 5].map((days, index) => ({
    id: `history-${index}`,
    connectionId: 'connection',
    sourceId: 'source',
    identifier: `H-${index}`,
    title: 'Synthetic comparable',
    description: '',
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: `2026-09-0${days + 1}T00:00:00.000Z`,
    observedCalendarDays: days,
    size: 'S' as const,
    points: 2,
    workType: 'backend' as const,
    scopeShape: 'bounded_change' as const,
  }));
  const suggested = buildRequirementEstimates(
    [complexity],
    new Map([
      [
        'REQ-1',
        {
          ...remaining,
          comparisonMatches: history.map((issue) => ({
            id: issue.id,
            reasoning: 'Same backend testing boundary',
          })),
        },
      ],
    ]),
    history,
    defaultOverrides(),
  );
  assert.equal(suggested[0]?.durationDays, 3);
  assert.equal(suggested[0]?.durationOverridden, false);
  const revised = buildRequirementEstimates(
    [complexity],
    new Map([
      [
        'REQ-1',
        {
          ...remaining,
          comparisonMatches: history.map((issue) => ({
            id: issue.id,
            reasoning: 'Same backend testing boundary',
          })),
        },
      ],
    ]),
    history,
    {
      ...defaultOverrides(),
      requirementPoints: { 'REQ-1': 5 },
      remainingPoints: { 'REQ-1': 3 },
      durations: { 'REQ-1': 7 },
      comparisons: { 'REQ-1': ['history-0'] },
    },
  );
  assert.equal(revised[0]?.points, 5);
  assert.equal(revised[0]?.suggestedPoints, 2);
  assert.equal(revised[0]?.remainingPoints, 3);
  assert.equal(revised[0]?.suggestedRemainingPoints, 2);
  assert.equal(revised[0]?.durationDays, null);
  assert.equal(revised[0]?.suggestedDurationDays, null);
  assert.equal(revised[0]?.durationOverridden, false);
  assert.deepEqual(revised[0]?.comparisons, []);
});

void test('comparison selection uses analogies for remaining work and hides elapsed time from the LLM', async () => {
  const { selectComparisons, durationSummary } =
    await import('../packages/estimation/src/index.js');
  const history = Array.from({ length: 6 }, (_, index) => ({
    id: `h-${index}`,
    connectionId: 'linear',
    sourceId: 'team',
    identifier: `TEAM-${index}`,
    title: 'Backend authorization change',
    description: 'Update permission checks and negative-path tests',
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: `2026-09-0${index + 2}T00:00:00.000Z`,
    observedCalendarDays: index + 1,
    size: 'S' as const,
    points: 2,
    workType: 'backend' as const,
    scopeShape: 'bounded_change' as const,
  }));
  const matched = {
    ...remaining,
    comparisonMatches: history.slice(1).map((issue) => ({
      id: issue.id,
      reasoning: 'Same authorization boundary and negative-path tests',
    })),
  };
  let modelInput: any;
  const stage: ModelStage = (_name, _schema, input, validate) => {
    modelInput = input;
    return Promise.resolve(validate({ requirements: [matched] }));
  };
  await remainingEstimates(stage, baseline, report, { emit: () => {} }, run, history);
  assert.ok(modelInput.history.length);
  assert.equal('startedAt' in modelInput.history[0], false);
  assert.equal('completedAt' in modelInput.history[0], false);
  assert.equal('observedCalendarDays' in modelInput.history[0], false);
  const row = buildRequirementEstimates(
    [{ ...complexity, size: 'L', points: 5 }],
    new Map([['REQ-1', matched]]),
    history,
    defaultOverrides(),
  )[0]!;
  assert.deepEqual(row.comparisons, ['h-5', 'h-4', 'h-3', 'h-2', 'h-1']);
  assert.equal(row.durationDays, 4, 'match remaining size, not original feature size');
  assert.deepEqual(durationSummary(selectComparisons(row, history)), {
    count: 5,
    median: 4,
    p10: 2,
    p90: 6,
  });
  assert.deepEqual(
    selectComparisons(row, [...history, history[5]!]).map((issue) => issue.id),
    row.comparisons,
  );
  assert.equal(durationSummary(selectComparisons(row, history, ['h-1', 'h-2'])), null);
  assert.deepEqual(
    selectComparisons({ ...row, remaining: { ...matched, comparisonMatches: [] } }, history),
    [],
  );
  assert.deepEqual(
    selectComparisons({ ...row, remaining: { ...matched, workType: 'unknown' } }, history),
    [],
  );
  assert.deepEqual(selectComparisons({ ...row, remainingPoints: null }, history), []);
  assert.deepEqual(selectComparisons({ ...row, remainingPoints: 0 }, history), []);
  assert.deepEqual(selectComparisons({ ...row, remaining: null }, history), []);
  for (const changed of [
    { startedAt: null },
    { completedAt: null },
    { startedAt: 'bad' },
    { completedAt: 'bad' },
    { completedAt: '2026-08-01T00:00:00.000Z' },
    { observedCalendarDays: null },
    { observedCalendarDays: -1 },
    { observedCalendarDays: NaN },
    { workType: 'ui' as const },
    { scopeShape: 'multi_part' as const },
    { points: 8 },
  ]) {
    assert.deepEqual(
      selectComparisons(
        row,
        history.map((issue) => ({ ...issue, ...changed })),
      ),
      [],
    );
  }
  for (const comparisonMatches of [
    [{ id: 'invented', reasoning: 'Invented' }],
    [
      { id: 'h-1', reasoning: 'First' },
      { id: 'h-1', reasoning: 'Duplicate' },
    ],
  ]) {
    await assert.rejects(
      remainingEstimates(
        stageFor({ requirements: [{ ...remaining, comparisonMatches }] }),
        baseline,
        report,
        { emit: () => {} },
        run,
        history,
      ),
      /unique eligible/,
    );
  }
  const wrongSize = { ...matched, points: 3, size: 'M' };
  await assert.rejects(
    remainingEstimates(
      stageFor({ requirements: [wrongSize] }),
      baseline,
      report,
      { emit: () => {} },
      run,
      history,
    ),
    /unique eligible/,
  );
});
