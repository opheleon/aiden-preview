import {
  type Baseline,
  type Complexity,
  ComplexityOutputSchema,
  type EstimateOverrides,
  HistoryClassificationOutputSchema,
  type HistoryIssue,
  type RemainingEstimate,
  RemainingOutputSchema,
  type Report,
  type RequirementEstimate,
  type RunManifest,
  type Snapshot,
} from '../../contracts/src/index.js';
import { durationSummary, selectComparisons, SIZE_POINTS } from '../../estimation/src/index.js';
import type { UnclassifiedHistory } from './history-normalization.js';
import type { ModelStage } from './model-stage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Estimate each reviewed requirement exactly once using the shared scope rubric. */
export async function originalEstimates(
  stage: ModelStage,
  baseline: Baseline,
  snapshots: Snapshot[] = [],
): Promise<Complexity[]> {
  const complexity = await stage(
    'estimate-original',
    ComplexityOutputSchema,
    { baseline: baseline.product, snapshots },
    (value) => {
      const result = ComplexityOutputSchema.parse(value);
      const expected = baseline.product.requirements.map((r) => r.id).sort();
      if (
        JSON.stringify(result.requirements.map((r) => r.requirementId).sort()) !==
        JSON.stringify(expected)
      )
        throw new Error('Estimate exactly every reviewed requirement once.');
      for (const row of result.requirements)
        if (row.points !== SIZE_POINTS[row.size])
          throw new Error(`${row.requirementId}: points must match the XS/S/M/L/XL scale.`);
      return result;
    },
  );

  return complexity.requirements;
}
/** Classify retrieved history once per stable record ID without changing observed timing evidence. */
export async function historicalEstimates(
  stage: ModelStage,
  rows: UnclassifiedHistory[],
): Promise<HistoryIssue[]> {
  let history: HistoryIssue[] = [];
  if (rows.length) {
    const classification = await stage(
      'estimate-history',
      HistoryClassificationOutputSchema,
      {
        issues: rows.map(({ id, identifier, title, description }) => ({
          id,
          identifier,
          title,
          description,
        })),
      },
      (value) => {
        const result = HistoryClassificationOutputSchema.parse(value);
        const expected = rows.map((row) => row.id).sort();
        if (JSON.stringify(result.issues.map((row) => row.id).sort()) !== JSON.stringify(expected))
          throw new Error('Classify every retrieved historical issue once.');
        for (const row of result.issues)
          if (row.points !== SIZE_POINTS[row.size])
            throw new Error(`${row.id}: historical points must match the shared rubric.`);
        return result;
      },
    );
    const byId = new Map(classification.issues.map((row) => [row.id, row]));
    history = rows.map((row) => ({ ...row, ...byId.get(row.id)! }));
  }

  return history;
}
/**
 * Remaining work for requirements the code check found entirely missing: the whole requirement,
 * as originally sized, so no second model pass is spent on code that does not exist yet.
 * Example: REQ-2 missing and sized M (3 points) gives remaining M (3 points).
 */
function missingRemaining(report: Report, complexity: Complexity[]): RemainingEstimate[] {
  return complexity.flatMap((original) => {
    const assessment = report.assessments.find((a) => a.requirementId === original.requirementId);
    if (assessment?.status !== 'missing') return [];
    return [
      {
        requirementId: original.requirementId,
        estimable: true,
        comparisonMatches: [],
        workType: original.workType,
        scopeShape: original.scopeShape,
        size: original.size,
        points: original.points,
        reasoning: `Nothing is built yet, so all of it remains. ${original.reasoning}`,
        workItems: original.workItems,
        unknowns: [],
      },
    ];
  });
}

/**
 * Estimate remaining work only when an accepted report establishes the current coverage.
 * Requirements the report found missing reuse their original size; only partly built or uncertain
 * ones go to the remaining-work estimator, and none do when nothing is built.
 */
export async function remainingEstimates(
  stage: ModelStage,
  baseline: Baseline,
  report: Report | null,
  context: Pick<WorkflowContext, 'emit'>,
  run: RunManifest,
  history: HistoryIssue[] = [],
  complexity: Complexity[] = [],
): Promise<Map<string, RemainingEstimate>> {
  if (!report) return new Map();
  const settled = missingRemaining(report, complexity);
  const open = baseline.product.requirements.filter(
    (r) => !settled.some((row) => row.requirementId === r.id),
  );
  const remaining = new Map(settled.map((row) => [row.requirementId, row]));
  if (!open.length) return remaining;
  context.emit({
    type: 'progress',
    runId: run.id,
    projectId: run.projectId,
    stage: 'estimate',
    message: 'Estimating the work that remains in the accepted assessment…',
  });
  const ids = new Set(open.map((r) => r.id));
  const result = await stage(
    'estimate-remaining',
    RemainingOutputSchema,
    {
      baseline: { ...baseline.product, requirements: open },
      report: {
        ...report,
        assessments: report.assessments.filter((a) => ids.has(a.requirementId)),
      },
      history: history
        .filter(
          (issue) => issue.startedAt && issue.completedAt && issue.observedCalendarDays !== null,
        )
        .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
        .map(({ id, title, description, size, points, workType, scopeShape, reasoning }) => ({
          id,
          title,
          description,
          size,
          points,
          workType,
          scopeShape,
          reasoning,
        })),
    },
    (value) => {
      const parsed = RemainingOutputSchema.parse(value);
      if (
        JSON.stringify(parsed.requirements.map((r) => r.requirementId).sort()) !==
        JSON.stringify([...ids].sort())
      )
        throw new Error('Estimate remaining work for every reviewed requirement once.');
      for (const row of parsed.requirements) {
        validateRemaining(row, report);
        validateMatches(row, history);
      }
      return parsed;
    },
  );
  for (const row of result.requirements) remaining.set(row.requirementId, row);
  return remaining;
}
/** Reject unjustified zero-work or complete-coverage claims and enforce rubric consistency. */
function validateRemaining(row: RemainingEstimate, report: Report): void {
  const assessment = report.assessments.find((a) => a.requirementId === row.requirementId)!;
  verifyRemainingCoverage(row, assessment);
  if (row.size && row.points !== SIZE_POINTS[row.size])
    throw new Error(
      `${row.requirementId}: nonzero remaining points must match the shared size scale.`,
    );
  if (!row.estimable && (row.points !== null || row.size !== null))
    throw new Error(`${row.requirementId}: unknown work cannot receive points.`);
}
/** Combine model suggestions with user overrides while preserving which values were supplied manually. */
export function buildRequirementEstimates(
  complexity: Complexity[],
  remaining: Map<string, RemainingEstimate>,
  history: HistoryIssue[],
  overrides: EstimateOverrides,
): RequirementEstimate[] {
  const requirementEstimates = complexity.map((original) => {
    const remainingRow = remaining.get(original.requirementId) ?? null;
    const points = overrides.requirementPoints[original.requirementId] ?? original.points;
    const suggestedRemainingPoints = remainingRow?.points ?? null;
    const remainingPoints =
      overrides.remainingPoints[original.requirementId] ?? suggestedRemainingPoints;
    const base = {
      requirementId: original.requirementId,
      original,
      suggestedPoints: original.points,
      points,
      pointsOverridden: original.requirementId in overrides.requirementPoints,
      remaining: remainingRow,
      suggestedRemainingPoints,
      remainingPoints,
      remainingPointsOverridden: original.requirementId in overrides.remainingPoints,
      durationDays: null,
      suggestedDurationDays: null,
      durationOverridden: false,
      comparisons: [] as string[],
      comparisonOverrides: overrides.comparisons[original.requirementId] ?? null,
    };
    const comparisons = selectComparisons(base, history, base.comparisonOverrides ?? undefined);
    const summary = durationSummary(comparisons);
    return {
      ...base,
      durationDays: summary?.median ?? null,
      suggestedDurationDays: summary?.median ?? null,
      durationOverridden: false,
      comparisons: comparisons.map((issue) => issue.id),
    };
  });

  return requirementEstimates;
}

/** Keep completion and uncertainty claims aligned with the accepted assessment evidence. */
function verifyRemainingCoverage(
  row: RemainingEstimate,
  assessment: Report['assessments'][number],
): void {
  if (
    assessment.status === 'implemented' &&
    !assessment.deviation &&
    (row.points !== 0 || !row.estimable)
  )
    throw new Error(
      `${row.requirementId}: fully implemented requirements without deviations must have zero remaining work.`,
    );
  if (assessment.status === 'unknown' && row.estimable)
    throw new Error(
      `${row.requirementId}: unknown assessment coverage cannot receive a remaining-work estimate.`,
    );
  if (
    (assessment.status === 'partial' || assessment.status === 'missing' || assessment.deviation) &&
    row.estimable &&
    !row.workItems.length
  )
    throw new Error(`${row.requirementId}: estimable remaining work needs concrete work items.`);
}

/** Reject invented, duplicated, or incompatible comparison IDs; timing evidence is never model-generated. */
function validateMatches(row: RemainingEstimate, history: HistoryIssue[]): void {
  const seen = new Set<string>();
  for (const match of row.comparisonMatches ?? []) {
    const issue = history.find((value) => value.id === match.id);
    if (
      !row.estimable ||
      !row.points ||
      seen.has(match.id) ||
      !issue ||
      issue.points !== row.points ||
      issue.workType !== row.workType ||
      issue.scopeShape !== row.scopeShape ||
      row.workType === 'unknown' ||
      row.scopeShape === 'unknown' ||
      !issue.startedAt ||
      !issue.completedAt ||
      issue.observedCalendarDays === null
    ) {
      throw new Error(
        `${row.requirementId}: comparisons must be unique eligible history IDs with matching size, work type, and scope.`,
      );
    }
    seen.add(match.id);
  }
}
