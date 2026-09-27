import { z } from 'zod/v3';

export const SizeSchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);
export const WorkTypeSchema = z.enum([
  'ui',
  'backend',
  'data',
  'integration',
  'infrastructure',
  'mixed',
  'unknown',
]);
export const ScopeShapeSchema = z.enum(['bounded_change', 'multi_part', 'unknown']);
export const WorkItemSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    // Older artifacts omit this field; strict model outputs use null for unshared work.
    sharedKey: z.string().nullish(),
  })
  .strict();
export const ComplexitySchema = z
  .object({
    requirementId: z.string().regex(/^REQ-[1-9]\d*$/),
    size: SizeSchema,
    points: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
    reasoning: z.string().min(1),
    workType: WorkTypeSchema,
    scopeShape: ScopeShapeSchema,
    workItems: z.array(WorkItemSchema),
  })
  .strict();
export const ComplexityOutputSchema = z
  .object({ requirements: z.array(ComplexitySchema).min(1) })
  .strict();

export const RemainingEstimateSchema = z
  .object({
    requirementId: z.string().regex(/^REQ-[1-9]\d*$/),
    estimable: z.boolean(),
    size: SizeSchema.nullable(),
    points: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)])
      .nullable(),
    reasoning: z.string().min(1),
    workItems: z.array(WorkItemSchema),
    unknowns: z.array(z.string()),
  })
  .strict();
export const RemainingOutputSchema = z
  .object({ requirements: z.array(RemainingEstimateSchema).min(1) })
  .strict();

export const HistoryIssueSchema = z
  .object({
    connectionId: z.string().min(1),
    sourceId: z.string().min(1),
    id: z.string().min(1),
    identifier: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    url: z.string().url().optional(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    observedCalendarDays: z.number().nonnegative().nullable(),
    size: SizeSchema.nullable(),
    points: z.number().nonnegative().nullable(),
    workType: WorkTypeSchema,
    scopeShape: ScopeShapeSchema,
  })
  .strict();

export const HistoryClassificationSchema = z
  .object({
    id: z.string().min(1),
    size: SizeSchema,
    points: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
    reasoning: z.string().min(1),
    workType: WorkTypeSchema,
    scopeShape: ScopeShapeSchema,
  })
  .strict();
export const HistoryClassificationOutputSchema = z
  .object({ issues: z.array(HistoryClassificationSchema) })
  .strict();

export const ExternalReadReceiptSchema = z
  .object({
    connectionId: z.string().min(1),
    tool: z.string().min(1),
    argumentsHash: z.string().regex(/^[a-f0-9]{64}$/),
    resultHash: z.string().regex(/^[a-f0-9]{64}$/),
    calledAt: z.string().datetime(),
    recordCount: z.number().int().nonnegative(),
  })
  .strict();

export const RequirementEstimateSchema = z
  .object({
    requirementId: z.string().regex(/^REQ-[1-9]\d*$/),
    original: ComplexitySchema,
    suggestedPoints: z.number().nonnegative(),
    points: z.number().nonnegative(),
    pointsOverridden: z.boolean(),
    remaining: RemainingEstimateSchema.nullable(),
    suggestedRemainingPoints: z.number().nonnegative().nullable(),
    remainingPoints: z.number().nonnegative().nullable(),
    remainingPointsOverridden: z.boolean(),
    durationDays: z.number().nonnegative().nullable(),
    suggestedDurationDays: z.number().nonnegative().nullable(),
    durationOverridden: z.boolean(),
    comparisons: z.array(z.string()),
    comparisonOverrides: z.array(z.string()).nullable(),
  })
  .strict();

export const ForecastSchema = z
  .object({
    referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    weeklyRate: z.number().positive().nullable(),
    rateSource: z.enum(['history', 'manual', 'unavailable']),
    capacityPercent: z.number().positive().max(100),
    remainingPoints: z.number().nonnegative().nullable(),
    remainingWorkingDays: z.number().int().nonnegative().nullable(),
    forecastFinish: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    targetVarianceWorkingDays: z.number().int().nullable(),
    implementedPoints: z.number().nonnegative(),
    totalPoints: z.number().nonnegative(),
    implementedPercent: z.number().min(0).max(100).nullable(),
    completeCoverage: z.boolean(),
    limitations: z.array(z.string()),
  })
  .strict();

export const EstimationSnapshotSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    estimatorVersion: z.literal('1'),
    id: z.string().min(1),
    projectId: z.string().min(1),
    baselineId: z.string().min(1),
    reportId: z.string().nullable(),
    runtime: z
      .object({
        provider: z.enum(['codex', 'claude']),
        auth: z.enum(['subscription', 'apiKey']),
        model: z.string().optional(),
      })
      .strict(),
    runtimeVersion: z.string(),
    sourceSelectionHash: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    historyCollectedAt: z.string().datetime().nullable(),
    historyComplete: z.boolean(),
    historyTruncated: z.boolean(),
    historyLimitations: z.array(z.string()),
    requirements: z.array(RequirementEstimateSchema).min(1),
    history: z.array(HistoryIssueSchema),
    receipts: z.array(ExternalReadReceiptSchema),
    forecast: ForecastSchema,
    validation: z.literal('structure-and-sources-checked'),
  })
  .strict();

export const EstimateOverridesSchema = z
  .object({
    requirementPoints: z.record(z.string(), z.number().nonnegative()),
    remainingPoints: z.record(z.string(), z.number().nonnegative()),
    durations: z.record(z.string(), z.number().nonnegative()),
    comparisons: z.record(z.string(), z.array(z.string())),
    historicalPoints: z.record(z.string(), z.number().nonnegative()),
    manualWeeklyRate: z.number().positive().nullable(),
    capacityPercent: z.number().positive().max(100),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();

/** Ordered relative sizing buckets; these express scope, not a promise of elapsed time. */
export type Size = z.infer<typeof SizeSchema>;
/** Original requirement scope and reasoning, including work items used to detect shared effort. */
export type Complexity = z.infer<typeof ComplexitySchema>;
/** Evidence-based remaining scope; null sizing preserves uncertainty instead of implying zero work. */
export type RemainingEstimate = z.infer<typeof RemainingEstimateSchema>;
/** Normalized external work history with nullable timing and sizing when the source provides no evidence. */
export type HistoryIssue = z.infer<typeof HistoryIssueSchema>;
/** Hashes and timestamp of an approved hosted-tool read; source content and credentials are excluded. */
export type ExternalReadReceipt = z.infer<typeof ExternalReadReceiptSchema>;
/** Suggested values and explicit user overrides retained together for traceable forecasting. */
export type RequirementEstimate = z.infer<typeof RequirementEstimateSchema>;
/** Calendar projection with capacity, rate provenance, coverage, and limitations; unavailable values remain null. */
export type Forecast = z.infer<typeof ForecastSchema>;
/** Versioned persisted estimate tied to baseline, report, source selection, and external-read provenance. */
export type EstimationSnapshot = z.infer<typeof EstimationSnapshotSchema>;
/** User adjustments kept separate from model suggestions so recomputation preserves intentional edits. */
export type EstimateOverrides = z.infer<typeof EstimateOverridesSchema>;
