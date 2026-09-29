import type {
  EstimationSnapshot,
  RequirementEstimate,
} from '../../../../packages/contracts/src/index';
import { durationSummary, selectComparisons } from '../../../../packages/estimation/src/index';

export const sizes = [
  { label: 'XS', points: 1 },
  { label: 'S', points: 2 },
  { label: 'M', points: 3 },
  { label: 'L', points: 5 },
  { label: 'XL', points: 8 },
];
/** Display an observed duration while preserving unknown values as a question mark. */
export const durationText = (days: number | null): string =>
  Number.isFinite(days) ? `${days} ${days === 1 ? 'day' : 'days'}` : '?';

/** Recompute the displayed range from saved eligible evidence; legacy manual durations never become predictions. */
export function comparisonSummary(
  row: RequirementEstimate,
  snapshot: EstimationSnapshot,
): ReturnType<typeof durationSummary> {
  return durationSummary(selectComparisons(row, snapshot.history, row.comparisons));
}
