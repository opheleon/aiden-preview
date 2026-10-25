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
  requireExactIds,
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
      requireExactIds(
        'Estimate exactly every reviewed requirement once.',
        baseline.product.requirements.map((r) => r.id),
        result.requirements.map((r) => r.requirementId),
      );
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
        requireExactIds(
          'Classify every retrieved historical issue once.',
          rows.map((row) => row.id),
          result.issues.map((row) => row.id),
        );
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
 * Build the remaining-work input for the open requirements only, so the estimator is never handed
 * a settled ID as work to size. The delivery plan keeps only open requirements and drops features
 * left empty; deviations follow the open assessments. The report's project-wide text (summary,
 * risks, dependencies, unknowns) cannot be split per requirement, so it stays as context and
 * `alreadySized` names the settled IDs it may mention.
 * Example: REQ-1 partial and REQ-2 missing sends only REQ-1, with alreadySized naming REQ-2.
 */
function remainingInput(
  baseline: Baseline,
  report: Report,
  open: Baseline['product']['requirements'],
  settled: string[],
  history: HistoryIssue[],
): unknown {
  const ids = new Set(open.map((r) => r.id));
  const features = (baseline.product.deliveryPlan ?? [])
    .map((f) => ({ ...f, requirementIds: f.requirementIds.filter((id) => ids.has(id)) }))
    .filter((f) => f.requirementIds.length);
  const kept = new Set(features.map((f) => f.id));
  const product = {
    ...baseline.product,
    requirements: open,
    ...(baseline.product.deliveryPlan && {
      deliveryPlan: features.map((f) => ({
        ...f,
        dependsOn: f.dependsOn.filter((id) => kept.has(id)),
      })),
    }),
  };
  return {
    baseline: product,
    report: {
      ...report,
      baseline: product,
      assessments: report.assessments.filter((a) => ids.has(a.requirementId)),
      deviations: report.deviations.filter((d) => ids.has(d.requirementId)),
    },
    ...(settled.length > 0 && {
      alreadySized: {
        requirementIds: settled,
        note: 'These requirements have no code yet and keep their original size. Do not return them or count their work again, including platform work they own. The report summary, risks, dependencies, and unknowns describe the whole project and may mention them.',
      },
    }),
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
  };
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
  const result = await stage(
    'estimate-remaining',
    RemainingOutputSchema,
    remainingInput(
      baseline,
      report,
      open,
      settled.map((row) => row.requirementId),
      history,
    ),
    (value) => {
      const parsed = RemainingOutputSchema.parse(value);
      requireExactIds(
        'Estimate remaining work once for every requirement in the input baseline, and no others.',
        open.map((r) => r.id),
        parsed.requirements.map((r) => r.requirementId),
      );
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
