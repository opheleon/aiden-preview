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

/** Honor explicit comparison IDs or match size and scope, preferring work type with sufficient samples. */
export function selectComparisons(
  requirement: RequirementEstimate,
  history: HistoryIssue[],
  overrideIds?: string[],
): HistoryIssue[] {
  if (overrideIds) return history.filter((issue) => overrideIds.includes(issue.id));
  const sameSizeAndScope = history.filter(
    (issue) =>
      issue.points === requirement.points &&
      issue.scopeShape === requirement.original.scopeShape &&
      issue.observedCalendarDays !== null,
  );
  const sameType = sameSizeAndScope.filter(
    (issue) => issue.workType === requirement.original.workType,
  );
  return sameType.length >= 3 ? sameType : sameSizeAndScope;
}

/** Anchor a calendar-only date at UTC noon to avoid local DST changes in arithmetic. */
function utcDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}
/** Format a UTC calendar date independently of the machine’s local time zone. */
function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
/** Advance by weekdays only; holidays are intentionally not modeled. */
export function addWorkingDays(referenceDate: string, workingDays: number): string {
  const date = utcDate(referenceDate);
  let remaining = workingDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return isoDate(date);
}

/** Count signed weekdays between calendar dates, excluding the starting date. */
export function workingDayDifference(from: string, to: string): number {
  if (from === to) return 0;
  const direction = from < to ? 1 : -1;
  const date = utcDate(from);
  const end = utcDate(to);
  let days = 0;
  while (date.getTime() !== end.getTime()) {
    date.setUTCDate(date.getUTCDate() + direction);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) days += direction;
  }
  return days;
}

/** Calibrate points per week from complete 90-day history with at least three completed issues. */
export function historicalWeeklyRate(
  history: HistoryIssue[],
  historyComplete: boolean,
): number | null {
  if (!historyComplete) return null;
  const completed = history.filter((issue) => issue.completedAt && issue.points !== null);
  if (completed.length < 3) return null;
  return (completed.reduce((sum, issue) => sum + issue.points!, 0) * 7) / 90;
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

/** Describe the missing inputs and calendar assumptions that constrain a forecast. */
function forecastLimitations(
  hasReport: boolean,
  completeCoverage: boolean,
  weeklyRate: number | null,
  remainingKnown: boolean,
): string[] {
  const limitations: string[] = ['Weekends are excluded; holidays are not modeled.'];
  if (!hasReport) limitations.push('Run a code assessment to estimate remaining work.');
  if (!completeCoverage)
    limitations.push('Unknown assessment coverage prevents a complete-project forecast.');
  if (weeklyRate === null)
    limitations.push('Add a manual weekly rate or connect complete dated history.');
  if (!remainingKnown) limitations.push('Remaining work is unknown for at least one requirement.');
  return limitations;
}

/** Distinguish explicit velocity overrides from calibrated history and unavailable velocity. */
function rateSource(manual: number | null, historical: number | null): Forecast['rateSource'] {
  return manual ? 'manual' : historical === null ? 'unavailable' : 'history';
}

/** Compute deterministic scope and calendar forecasts from reviewed estimates, history, and manual inputs. */
export function buildForecast(input: {
  requirements: RequirementEstimate[];
  report: Report | null;
  history: HistoryIssue[];
  historyComplete: boolean;
  overrides: EstimateOverrides;
  referenceDate: string;
}): Forecast {
  const { requirements, report, history, historyComplete, overrides, referenceDate } = input;
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
  const historyRate = historicalWeeklyRate(history, historyComplete);
  const weeklyRate =
    overrides.manualWeeklyRate ??
    (historyRate === null ? null : historyRate * (overrides.capacityPercent / 100));
  const workingDays =
    remainingPoints !== null && weeklyRate ? Math.ceil((remainingPoints / weeklyRate) * 5) : null;
  const finish = workingDays === null ? null : addWorkingDays(referenceDate, workingDays);
  const limitations = forecastLimitations(!!report, completeCoverage, weeklyRate, remainingKnown);
  return {
    referenceDate,
    targetDate: overrides.targetDate,
    weeklyRate,
    rateSource: rateSource(overrides.manualWeeklyRate, historyRate),
    capacityPercent: overrides.capacityPercent,
    remainingPoints,
    remainingWorkingDays: workingDays,
    forecastFinish: finish,
    targetVarianceWorkingDays:
      finish && overrides.targetDate ? workingDayDifference(overrides.targetDate, finish) : null,
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
