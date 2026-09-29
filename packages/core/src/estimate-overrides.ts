import path from 'node:path';

import {
  type EstimateOverrides,
  EstimateOverridesSchema,
  type EstimationSnapshot,
  EstimationSnapshotSchema,
} from '../../contracts/src/index.js';
import { buildForecast, durationSummary, selectComparisons } from '../../estimation/src/index.js';
import { atomic, uid } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Recompute user overrides under the caller’s project lock; publish a new snapshot before moving its pointer. */
export async function applyOverrides(
  context: Pick<WorkflowContext, 'store' | 'getReport' | 'getEstimate'>,
  projectId: string,
  input: EstimateOverrides,
): Promise<EstimationSnapshot> {
  const overrides = EstimateOverridesSchema.parse(input);
  const current = await context.getEstimate(projectId);
  if (!current) throw new Error('Generate an estimate before applying overrides.');
  const history = current.history.map((issue) => ({
    ...issue,
    points: overrides.historicalPoints[issue.id] ?? issue.points,
  }));
  const requirements = current.requirements.map((requirement) => {
    const points =
      overrides.requirementPoints[requirement.requirementId] ?? requirement.suggestedPoints;
    const remainingPoints =
      overrides.remainingPoints[requirement.requirementId] ?? requirement.suggestedRemainingPoints;
    const overrideComparisons = overrides.comparisons[requirement.requirementId];
    const comparisons = selectComparisons(
      { ...requirement, points, remainingPoints },
      history,
      overrideComparisons,
    );
    const summary = durationSummary(comparisons);
    return {
      ...requirement,
      points,
      pointsOverridden: requirement.requirementId in overrides.requirementPoints,
      remainingPoints,
      remainingPointsOverridden: requirement.requirementId in overrides.remainingPoints,
      durationDays: summary?.median ?? null,
      suggestedDurationDays: summary?.median ?? null,
      durationOverridden: false,
      comparisons: comparisons.map((issue) => issue.id),
      comparisonOverrides: overrideComparisons ?? null,
    };
  });
  const report = current.reportId ? await context.getReport(projectId, current.reportId) : null;
  const next: EstimationSnapshot = EstimationSnapshotSchema.parse({
    ...current,
    id: uid(),
    generatedAt: new Date().toISOString(),
    history,
    requirements,
    forecast: buildForecast({
      requirements,
      report,
      history,
      historyComplete: current.historyComplete,
      overrides,
      referenceDate: new Date().toISOString().slice(0, 10),
    }),
  });
  await atomic(path.join(context.store.project(projectId), 'estimate-overrides.json'), overrides);
  await atomic(path.join(context.store.project(projectId), 'estimates', `${next.id}.json`), next);
  await atomic(path.join(context.store.project(projectId), 'latest-estimate.json'), {
    id: next.id,
  });
  return next;
}
