import type {
  EstimateOverrides,
  EstimationSnapshot,
  Forecast,
  HistoryIssue,
  Report,
  RequirementEstimate,
  Size,
} from '../../contracts/src/index.js';

export const SIZE_POINTS: Record<Size, 1 | 2 | 3 | 5 | 8> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 5,
  XL: 8,
};

/** Create fresh manual overrides so projects never share mutable estimate settings. */
export const defaultOverrides = (): EstimateOverrides => ({
  requirementPoints: {},
  remainingPoints: {},
  durations: {},
  comparisons: {},
  historicalPoints: {},
  manualWeeklyRate: null,
  capacityPercent: 100,
  targetDate: null,
});

/** Select a nearest-rank percentile without mutating samples; empty inputs have no percentile. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))] ?? null;
}

/** Summarize finite observed calendar durations only when at least three examples are available. */
export function durationSummary(
  issues: HistoryIssue[],
): { count: number; median: number; p10: number; p90: number } | null {
  const values = issues
    .map((issue) => issue.observedCalendarDays)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p10: percentile(sorted, 0.1)!,
    p90: percentile(sorted, 0.9)!,
  };
}

/** Validate the model’s analogous remaining-work matches against size, work type, and scope.
 * Only dated completed issues qualify. Saved selection may narrow these candidates, never bypass eligibility.
 * Collection already limits history to 90 days; the five most recent matches keep explanations inspectable.
 */
export function selectComparisons(
  requirement: RequirementEstimate,
  history: HistoryIssue[],
  overrideIds?: string[],
): HistoryIssue[] {
  const scope = requirement.remaining;
  if (!scope?.comparisonMatches) return [];
  const matched = new Set(scope.comparisonMatches.map((match) => match.id));
  const points = requirement.remainingPoints;
  if (
    !points ||
    !scope.workType ||
    scope.workType === 'unknown' ||
    !scope.scopeShape ||
    scope.scopeShape === 'unknown'
  )
    return [];
  const seen = new Set<string>();
  return history
    .filter((issue) => {
      if (seen.has(issue.id)) return false;
      seen.add(issue.id);
      return (
        matched.has(issue.id) &&
        issue.points === points &&
        issue.workType === scope.workType &&
        issue.scopeShape === scope.scopeShape &&
        issue.startedAt !== null &&
        issue.completedAt !== null &&
        Number.isFinite(Date.parse(issue.startedAt)) &&
        Number.isFinite(Date.parse(issue.completedAt)) &&
        issue.startedAt <= issue.completedAt &&
        issue.observedCalendarDays !== null &&
        Number.isFinite(issue.observedCalendarDays) &&
        issue.observedCalendarDays >= 0 &&
        (!overrideIds || overrideIds.includes(issue.id))
      );
    })
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!) || a.id.localeCompare(b.id))
    .slice(0, 5);
}

/** Fall back to aggregate points when an older estimate has no detailed work-item breakdown. */
function workItemsFor(requirement: RequirementEstimate, kind: 'original' | 'remaining') {
  return kind === 'original'
    ? (requirement.original?.workItems ?? [])
    : (requirement.remaining?.workItems ?? []);
}

/** Add unshared portions immediately and retain the largest shared portion for later deduplication. */
function addRequirementPoints(
  requirement: RequirementEstimate,
  kind: 'original' | 'remaining',
  included: Set<string> | undefined,
  shared: Map<string, { points: number; requirements: Set<string> }>,
): number {
  let total = 0;
  const points = kind === 'original' ? requirement.points : requirement.remainingPoints;
  if (points === null) return 0;
  const items = workItemsFor(requirement, kind);
  if (!items.length) {
    if (!included || included.has(requirement.requirementId)) total += points;
    return total;
  }
  const portion = points / items.length;
  for (const item of items) {
    if (!item.sharedKey) {
      if (!included || included.has(requirement.requirementId)) total += portion;
      continue;
    }
    const prior = shared.get(item.sharedKey) ?? { points: 0, requirements: new Set<string>() };
    prior.points = Math.max(prior.points, portion);
    prior.requirements.add(requirement.requirementId);
    shared.set(item.sharedKey, prior);
  }
  return total;
}

/** Sum scoped work while counting a shared item only once and only when all its owners are included. */
function deduplicatedPoints(
  requirements: RequirementEstimate[],
  kind: 'original' | 'remaining',
  included?: Set<string>,
) {
  let total = 0;
  const shared = new Map<string, { points: number; requirements: Set<string> }>();
  for (const requirement of requirements)
    total += addRequirementPoints(requirement, kind, included, shared);
  for (const item of shared.values())
    if (!included || [...item.requirements].every((id) => included.has(id))) total += item.points;
  return Math.round(total * 100) / 100;
}

/** Retain the saved forecast contract while reporting scope only; retired velocity inputs never produce dates. */
export function buildForecast(input: {
  requirements: RequirementEstimate[];
  report: Report | null;
  history: HistoryIssue[];
  historyComplete: boolean;
  overrides: EstimateOverrides;
  referenceDate: string;
}): Forecast {
  const { requirements, report, overrides, referenceDate } = input;
  const statuses = new Map(report?.assessments.map((a) => [a.requirementId, a]) ?? []);
  const completeCoverage = !!report && report.assessments.every((a) => a.status !== 'unknown');
  const implemented = new Set(
    requirements
      .filter((requirement) => statuses.get(requirement.requirementId)?.status === 'implemented')
      .map((requirement) => requirement.requirementId),
  );
  const implementedPoints = deduplicatedPoints(requirements, 'original', implemented);
  const totalPoints = deduplicatedPoints(requirements, 'original');
  const remainingKnown = requirements.every((requirement) => requirement.remainingPoints !== null);
  const remainingPoints = remainingKnown ? deduplicatedPoints(requirements, 'remaining') : null;
  const limitations = [
    'Time estimates use comparable completed tickets, including review and waiting time.',
    'Individual ticket durations are not added into a project finish date: dependencies and parallel work are not scheduled.',
  ];
  if (!completeCoverage) limitations.push('Assessment coverage is incomplete.');
  if (!remainingKnown) limitations.push('Remaining work is unknown for at least one requirement.');
  return {
    referenceDate,
    targetDate: overrides.targetDate,
    weeklyRate: null,
    rateSource: 'unavailable',
    capacityPercent: overrides.capacityPercent,
    remainingPoints,
    remainingWorkingDays: null,
    forecastFinish: null,
    targetVarianceWorkingDays: null,
    implementedPoints,
    totalPoints,
    implementedPercent:
      completeCoverage && totalPoints > 0
        ? Math.round((implementedPoints / totalPoints) * 1000) / 10
        : null,
    completeCoverage,
    limitations,
  };
}

/** Treat missing collection times or history older than 24 hours as requiring refresh. */
export function isHistoryStale(snapshot: EstimationSnapshot, now = Date.now()): boolean {
  if (!snapshot.historyCollectedAt) return true;
  return now - new Date(snapshot.historyCollectedAt).getTime() > 24 * 60 * 60 * 1000;
}
