import type {
  EstimateOverrides,
  EstimationSnapshot,
  Project,
} from '../../../../packages/contracts/src/index';
import { defaultOverrides } from '../../../../packages/estimation/src/index';
/** Create an unsaved local project using subscription authentication and no source access. */
export const newProject = (): Project => ({
  id: crypto.randomUUID(),
  name: '',
  context: '',
  repositories: [],
  runtime: { provider: 'codex', auth: 'subscription' },
});
/** Restore explicitly overridden estimate values while retaining automatic defaults elsewhere. */
export function overridesFrom(snapshot?: EstimationSnapshot): EstimateOverrides {
  if (!snapshot) return defaultOverrides();
  return {
    requirementPoints: Object.fromEntries(
      snapshot.requirements
        .filter((row) => row.pointsOverridden)
        .map((row) => [row.requirementId, row.points]),
    ),
    remainingPoints: Object.fromEntries(
      snapshot.requirements
        .filter((row) => row.remainingPointsOverridden && row.remainingPoints !== null)
        .map((row) => [row.requirementId, row.remainingPoints!]),
    ),
    durations: Object.fromEntries(
      snapshot.requirements
        .filter((row) => row.durationOverridden && row.durationDays !== null)
        .map((row) => [row.requirementId, row.durationDays!]),
    ),
    comparisons: Object.fromEntries(
      snapshot.requirements
        .filter((row) => row.comparisonOverrides)
        .map((row) => [row.requirementId, row.comparisonOverrides!]),
    ),
    historicalPoints: {},
    manualWeeklyRate:
      snapshot.forecast.rateSource === 'manual' ? snapshot.forecast.weeklyRate : null,
    capacityPercent: snapshot.forecast.capacityPercent,
    targetDate: snapshot.forecast.targetDate,
  };
}
/** Summarize observed comparison duration only when at least three dated samples exist. */
export function comparisonRange(snapshot: EstimationSnapshot, ids: string[]): string | null {
  const values = snapshot.history
    .filter((issue) => ids.includes(issue.id) && issue.observedCalendarDays !== null)
    .map((issue) => issue.observedCalendarDays!)
    .sort((a, b) => a - b);
  if (values.length < 3) return null;
  return `${values[Math.max(0, Math.ceil(values.length * 0.1) - 1)]}–${values[Math.max(0, Math.ceil(values.length * 0.9) - 1)]} days p10–p90`;
}
