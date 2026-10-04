import { expect, test } from 'vitest';

import { runBlockage } from '../../apps/desktop/src/renderer/run-blockers';
import { runStatus } from '../../apps/desktop/src/renderer/run-labels';
import type { Baseline, Call, RunManifest } from '../../packages/contracts/src/index';

const baseline: Baseline = {
  id: 'scope',
  projectId: 'project',
  contextHash: 'hash',
  reviewedAt: '2026-10-03',
  retiredIds: [],
  product: {
    overview: 'Synthetic scope',
    milestones: [],
    requirements: [
      { id: 'REQ-1', text: 'First' },
      { id: 'REQ-2', text: 'Second' },
    ],
  },
};
const run: RunManifest = {
  id: 'run',
  projectId: 'project',
  kind: 'report',
  status: 'completed',
  stage: 'complete',
  createdAt: '2026-10-03T10:00:00Z',
  baseline,
  project: {
    id: 'project',
    name: 'Synthetic',
    context: 'Synthetic',
    repositories: [],
    runtime: { provider: 'codex', auth: 'subscription' },
  },
};
const call: Call = {
  id: 'call',
  kind: 'decision',
  status: 'open',
  runId: 'scope-run',
  blocking: true,
  requirementId: 'REQ-1',
  edgeCaseId: null,
  question: 'Which access policy?',
  assumption: 'Access waits.',
  owner: 'you',
  options: [],
  askedAt: '2026-10-03T09:00:00Z',
  answeredAt: null,
  answer: null,
};

test('blocking labels distinguish partial work, full scope, and total sizing', () => {
  const partial = runBlockage(run, [call], baseline);
  expect(partial?.all).toBe(false);
  expect(runStatus(run, false, partial).label).toBe('Partly blocked');
  const full = runBlockage(run, [{ ...call, requirementId: null }], baseline);
  expect(full?.all).toBe(true);
  expect(runStatus(run, true, full).label).toBe('Blocked');
  expect(runBlockage({ ...run, kind: 'estimate' }, [call], baseline)?.all).toBe(true);
});

test('only outstanding decisions belonging to this run or its scope block it', () => {
  for (const change of [
    { status: 'answered' as const },
    { blocking: false },
    { askedAt: '2026-10-04T10:00:00Z' },
  ])
    expect(runBlockage(run, [{ ...call, ...change }], baseline)).toBeNull();
  expect(runBlockage(run, [call], { ...baseline, id: 'new-scope' })).toBeNull();
  expect(runBlockage({ ...run, kind: 'verify' }, [call], baseline)).toBeNull();
  for (const status of ['failed', 'cancelled'] as const)
    expect(runBlockage({ ...run, status }, [call], baseline)).toBeNull();
  const own = { ...call, runId: run.id, askedAt: '2026-10-03T11:00:00Z' };
  const preparing: RunManifest = { ...run, kind: 'prepare' };
  delete preparing.baseline;
  expect(runBlockage(preparing, [own], baseline)?.all).toBe(false);
  expect(runBlockage(preparing, [own])?.all).toBe(true);
});

test('dependent features count as blocked even when the decision names only their prerequisite', () => {
  const product = {
    ...baseline.product,
    deliveryPlan: [1, 2].map((n) => ({
      id: `F-${n}`,
      title: `Feature ${n}`,
      kind: 'feature' as const,
      outcome: 'Outcome',
      rationale: 'Synthetic',
      requirementIds: [`REQ-${n}`],
      dependsOn: n === 2 ? ['F-1'] : [],
    })),
  };
  expect(runBlockage({ ...run, baseline: { ...baseline, product } }, [call], baseline)?.all).toBe(
    true,
  );
});
