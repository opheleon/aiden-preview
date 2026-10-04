import { z } from 'zod/v3';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { DeliveryPlanSchema, validateDeliveryPlan } from './delivery-plan.js';
import { edgeCaseId, requirementId } from './ids.js';
import { ProjectSourcesSchema } from './integrations.js';
import { RuntimeSchema } from './runtime.js';
export * from './activity.js';
export * from './calls.js';
export * from './delivery-jobs.js';
export * from './delivery-plan.js';
export * from './estimation.js';
export * from './ids.js';
export * from './integrations.js';
export * from './runtime.js';
export * from './verification.js';

export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
/** A situation around a requirement that tends to break first; `found` marks one Aiden discovered while checking. */
export const EdgeCaseSchema = z
  .object({
    id: edgeCaseId,
    text: z.string().trim().min(1).max(300),
    origin: z.enum(['scope', 'found']),
  })
  .strict();
/** Edge cases are optional so baselines saved before they existed still parse. */
export const RequirementSchema = z
  .object({
    id: requirementId,
    text: z.string().trim().min(1),
    edgeCases: z.array(EdgeCaseSchema).max(8).optional(),
  })
  .strict();
export const ProductSchema = z
  .object({
    /** Scope-derived project name; absent on baselines saved before project naming. */
    title: z.string().trim().min(1).max(72).optional(),
    overview: z.string().trim().min(1),
    requirements: z.array(RequirementSchema).min(1),
    milestones: z.array(z.string()),
    /** Ordered vertical features; absent on projects created before delivery planning. */
    deliveryPlan: DeliveryPlanSchema.optional(),
    /** Repositories this intent is about; absent means every repository in the project. */
    repositories: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
  })
  .strict()
  .superRefine((product, context) => {
    if (product.deliveryPlan)
      validateDeliveryPlan(product.deliveryPlan, product.requirements, context);
  });
export const ProjectSchema = z
  .object({
    id,
    name: z.string().min(1),
    context: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    discoveryWarnings: z.array(z.string()).optional(),
    repositories: z
      .array(
        z
          .object({
            id,
            path: z.string().min(1),
            notes: z.string(),
            monitoredBranch: z
              .object({
                remote: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
                branch: z.string().min(1).max(1024),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1),
    runtime: RuntimeSchema,
    sources: ProjectSourcesSchema.optional(),
  })
  .strict();
export const SnapshotSchema = z
  .object({
    repositoryId: id,
    sha: z.string().regex(/^[a-f0-9]{40,64}$/),
    branch: z.string(),
    role: z.enum(['default', 'feature', 'integration', 'unknown']),
    reason: z.string(),
    /** Only fresh remote reads establish presence on the delivery branch. Older reports omit this. */
    source: z.enum(['remote-default', 'remote-branch', 'local']).optional(),
    checkedAt: z.string().datetime().optional(),
  })
  .strict();
export const DiscoverySchema = z
  .object({ snapshots: z.array(SnapshotSchema), warnings: z.array(z.string()) })
  .strict();
export const EvidenceSchema = z
  .object({
    repositoryId: id,
    sha: z.string(),
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    explanation: z.string().min(1),
  })
  .strict();
export const AssessmentSchema = z
  .object({
    requirementId: z.string(),
    status: z.enum(['implemented', 'partial', 'missing', 'unknown']),
    deviation: z.boolean(),
    explanation: z.string().min(1),
    evidence: z.array(EvidenceSchema),
    remainingWork: z.array(z.string()),
    unknowns: z.array(z.string()),
  })
  .strict();
export const FindingsSchema = z
  .object({
    assessments: z.array(AssessmentSchema).min(1),
    risks: z.array(z.string()),
    dependencies: z.array(z.string()),
    unknowns: z.array(z.string()),
  })
  .strict();
export const SummarySchema = z.object({ summary: z.string().min(1) }).strict();
export const ReportSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    workflowVersion: z.literal('1'),
    id,
    projectId: id,
    baselineId: id,
    generatedAt: z.string().datetime(),
    runtime: RuntimeSchema,
    runtimeVersion: z.string(),
    baseline: ProductSchema,
    snapshots: z.array(SnapshotSchema),
    summary: z.string().min(1),
    assessments: z.array(AssessmentSchema),
    deviations: z.array(
      z
        .object({
          requirementId: z.string(),
          explanation: z.string(),
          evidence: z.array(EvidenceSchema),
        })
        .strict(),
    ),
    risks: z.array(z.string()),
    dependencies: z.array(z.string()),
    unknowns: z.array(z.string()),
    warnings: z.array(z.string()),
    validation: z.literal('structure-and-evidence-checked'),
  })
  .strict();
export const PrepareSchema = z.object({ project: ProjectSchema }).strict();
/** Saved project intent, selected repository roots, and the explicitly chosen provider billing mode. */
export type Project = z.infer<typeof ProjectSchema>;
/** Bounded folder-scan results; warnings identify repositories that may have been excluded. */
export type RepositoryDiscovery = {
  rootPath: string;
  repositories: Project['repositories'];
  warnings: string[];
};
/** Human-reviewable requirements with stable IDs; approval creates a baseline from this intent. */
export type Product = z.infer<typeof ProductSchema>;
/** One requirement in plain language with the edge cases that decide whether it really works. */
export type Requirement = z.infer<typeof RequirementSchema>;
/** A situation around a requirement that tends to break first. */
export type EdgeCase = z.infer<typeof EdgeCaseSchema>;
/** Explicit provider, authentication source, and optional model selection; adapters must not change billing mode. */
export type RuntimeConfig = z.infer<typeof RuntimeSchema>;
/** Immutable selected commit and its analysis role; evidence must match this repository and SHA. */
export type Snapshot = z.infer<typeof SnapshotSchema>;
/** Provider-selected snapshots constrained to the independently collected Git inventory. */
export type Discovery = z.infer<typeof DiscoverySchema>;
/** Per-requirement conclusions; acceptance requires complete coverage and inspected evidence for supported claims. */
export type Findings = z.infer<typeof FindingsSchema>;
/** Versioned accepted report retaining the reviewed intent, frozen snapshots, and evidence-validation marker. */
export type Report = z.infer<typeof ReportSchema>;
/** Inclusive source-line citation; validity requires a matching frozen snapshot and contiguous read receipts. */
export type Evidence = z.infer<typeof EvidenceSchema>;
/** Inclusive lines actually returned by a successful snapshot read, persisted before evidence is accepted. */
export type ReadReceipt = {
  repositoryId: string;
  sha: string;
  path: string;
  startLine: number;
  endLine: number;
};
/** Approved product intent plus retired IDs, allowing later runs to preserve requirement identity. */
export type Baseline = {
  id: string;
  projectId: string;
  contextHash: string;
  /** Decisions used to establish this scope; absent on legacy baselines. */
  decisionsHash?: string;
  product: Product;
  reviewedAt: string;
  retiredIds: string[];
};
/** Persisted workflow position used by progress events and resumable run manifests. */
export type Stage =
  | 'understand'
  | 'review'
  | 'sync'
  | 'discover'
  | 'assess'
  | 'summary'
  | 'report'
  | 'estimate'
  | 'verify'
  | 'complete';
/** Worker progress and terminal notifications; optional payloads depend on the event type and stage. */
export type RunEvent = {
  projectId?: string;
  type: 'progress' | 'activity' | 'review' | 'completed' | 'failed' | 'cancelled' | 'coding';
  codingActive?: boolean;
  runId: string;
  stage?: Stage;
  message?: string;
  activity?: import('./activity.js').ActivityEntry;
  report?: Report;
  product?: Product;
  estimation?: import('./estimation.js').EstimationSnapshot;
  verification?: import('./verification.js').VerificationSummary;
};
/** Persisted run lifecycle and starting context; accepted reports remain separate from interrupted work. */
export type RunManifest = {
  /** Deployment identity checked before and after a scheduled beta run. */
  beta?: { jobId: string; revision: string; revisionUrl: string };
  id: string;
  projectId: string;
  kind: 'prepare' | 'report' | 'estimate' | 'verify';
  status: 'running' | 'waiting' | 'review' | 'completed' | 'failed' | 'cancelled';
  stage: Stage;
  project: Project;
  baseline?: Baseline;
  error?: string;
  createdAt: string;
  runtimeVersion?: string;
  runtimeModel?: string;
  latestAtStart?: string | null;
  verifyUrl?: string;
  /** A prepare run that commits its own baseline instead of stopping for review. */
  autoAccept?: boolean;
  /** Why Aiden started this run, shown in the action log. */
  reason?: LookReason;
};
/** What prompted Aiden to look: you asked, code changed, the morning check, or the intent or a call changed. */
export type LookReason = 'you' | 'commit' | 'morning' | 'ticket' | 'intent' | 'answer';
/** Convert tool arguments to JSON Schema while retaining ordinary optional properties. */
export const schemaFor = (schema: z.ZodType<unknown>): Record<string, unknown> =>
  zodToJsonSchema(schema, { $refStrategy: 'none' });

// Model outputs require every property, using null for an absent optional value.
// Keep ordinary MCP input schemas separate so optional tool arguments stay optional.
// The openAi target declares draft 2019-09 and emits draft-04 boolean exclusive bounds, both of
// which Claude Code's --json-schema validator rejects; normalize to numeric exclusive bounds.
/** Normalize nested exclusive bounds to the numeric dialect accepted by provider validators. */
const numericBounds = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(numericBounds);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = numericBounds(v);
  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (out[flag] === true) {
      out[flag] = out[bound];
      delete out[bound];
    } else if (out[flag] === false) delete out[flag];
  }
  return out;
};
/** Require model-output properties with nullable absence, without changing MCP input semantics. */
export const outputSchemaFor = (schema: z.ZodType<unknown>): Record<string, unknown> => {
  const rest = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'openAi',
  });
  delete rest.$schema;
  return numericBounds(rest) as Record<string, unknown>;
};
/** Reject duplicate requirement or edge-case IDs before intent becomes a baseline or is compared with a later report. */
export function assertUniqueRequirements(product: Product): void {
  if (new Set(product.requirements.map((r) => r.id)).size !== product.requirements.length)
    throw new Error('Requirement IDs must be unique.');
  for (const r of product.requirements) {
    const edges = r.edgeCases ?? [];
    if (new Set(edges.map((e) => e.id)).size !== edges.length)
      throw new Error(`${r.id}: edge case IDs must be unique.`);
  }
}
/** Accept normalized relative artifact paths without traversal, platform drive prefixes, or NULs. */
export function safeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((p) => p === '..' || p === '.' || p === '') &&
    !/^[A-Za-z]:/.test(path)
  );
}
/** Accept exactly one assessment per reviewed requirement and verify all supporting evidence receipts. */
export function validateFindings(
  value: unknown,
  product: Product,
  snapshots: Snapshot[],
  reads: ReadReceipt[],
): Findings {
  const f = FindingsSchema.parse(value);
  const expected = product.requirements.map((r) => r.id).sort();
  if (JSON.stringify(f.assessments.map((a) => a.requirementId).sort()) !== JSON.stringify(expected))
    throw new Error('Assess exactly every reviewed requirement once.');
  for (const a of f.assessments) {
    if ((a.status === 'implemented' || a.status === 'partial' || a.deviation) && !a.evidence.length)
      throw new Error(`${a.requirementId}: supported and contradictory claims require evidence.`);
    if (a.status === 'unknown' && !a.unknowns.length)
      throw new Error(`${a.requirementId}: unknown status needs a limitation.`);
    for (const evidence of a.evidence) validateEvidence(evidence, snapshots, reads);
  }
  return f;
}
/** Reject reports that alter reviewed intent, frozen snapshots, or derived deviation findings. */
export function validateReport(
  value: unknown,
  baseline: Baseline,
  snapshots: Snapshot[],
  reads: ReadReceipt[],
): Report {
  const r = ReportSchema.parse(value);
  if (
    r.projectId !== baseline.projectId ||
    r.baselineId !== baseline.id ||
    JSON.stringify(r.baseline) !== JSON.stringify(baseline.product)
  )
    throw new Error('Report baseline does not match reviewed intent.');
  if (JSON.stringify(r.snapshots) !== JSON.stringify(snapshots))
    throw new Error('Report snapshots changed.');
  const deviations = r.assessments
    .filter((a) => a.deviation)
    .map((a) => ({
      requirementId: a.requirementId,
      explanation: a.explanation,
      evidence: a.evidence,
    }));
  if (JSON.stringify(r.deviations) !== JSON.stringify(deviations))
    throw new Error('Deviation findings do not match requirement assessments.');
  validateFindings(
    {
      assessments: r.assessments,
      risks: r.risks,
      dependencies: r.dependencies,
      unknowns: r.unknowns,
    },
    baseline.product,
    snapshots,
    reads,
  );
  return r;
}

/** Require safe citation ranges covered contiguously by reads from the exact selected snapshot. */
function validateEvidence(e: Evidence, snapshots: Snapshot[], reads: ReadReceipt[]): void {
  if (!safeRelative(e.path) || e.endLine < e.startLine)
    throw new Error('Evidence paths and line ranges must be safe.');
  if (!snapshots.some((s) => s.repositoryId === e.repositoryId && s.sha === e.sha))
    throw new Error('Evidence references an unselected snapshot.');
  let next = e.startLine;
  for (const r of reads
    .filter((r) => r.repositoryId === e.repositoryId && r.sha === e.sha && r.path === e.path)
    .sort((a, b) => a.startLine - b.startLine)) {
    if (r.startLine > next) break;
    next = Math.max(next, r.endLine + 1);
  }
  if (next <= e.endLine) throw new Error('Evidence must reference lines actually read.');
}
