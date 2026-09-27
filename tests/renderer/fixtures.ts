import { readFileSync } from 'node:fs';

import { EstimationSnapshotSchema, ReportSchema } from '../../packages/contracts/src/index';
// Compatibility input: previously recorded provider report on synthetic repositories.
export const report = ReportSchema.parse(
  JSON.parse(readFileSync('examples/reports/codex-live.json', 'utf8')),
);
export function estimateFixture() {
  const estimation = EstimationSnapshotSchema.parse({
    schemaVersion: '1.0',
    estimatorVersion: '1',
    id: 'synthetic-estimate',
    projectId: report.projectId,
    baselineId: report.baselineId,
    reportId: report.id,
    runtime: report.runtime,
    runtimeVersion: 'fixture',
    sourceSelectionHash: 'a'.repeat(64),
    generatedAt: report.generatedAt,
    historyCollectedAt: null,
    historyComplete: false,
    historyTruncated: false,
    historyLimitations: [],
    history: [],
    receipts: [],
    validation: 'structure-and-sources-checked',
    requirements: report.baseline.requirements.map((requirement) => ({
      requirementId: requirement.id,
      original: {
        requirementId: requirement.id,
        size: 'S',
        points: 2,
        reasoning: 'Synthetic scope classification',
        workType: 'integration',
        scopeShape: 'bounded_change',
        workItems: [{ id: 'work', text: 'Implement requirement', sharedKey: null }],
      },
      suggestedPoints: 2,
      points: 2,
      pointsOverridden: false,
      remaining: null,
      suggestedRemainingPoints: null,
      remainingPoints: null,
      remainingPointsOverridden: false,
      durationDays: null,
      suggestedDurationDays: null,
      durationOverridden: false,
      comparisons: [],
      comparisonOverrides: null,
    })),
    forecast: {
      referenceDate: '2026-09-26',
      targetDate: null,
      weeklyRate: null,
      rateSource: 'unavailable',
      capacityPercent: 100,
      remainingPoints: null,
      remainingWorkingDays: null,
      forecastFinish: null,
      targetVarianceWorkingDays: null,
      implementedPoints: 0,
      totalPoints: 4,
      implementedPercent: null,
      completeCoverage: false,
      limitations: ['Remaining work is unknown'],
    },
  });
  return estimation;
}
