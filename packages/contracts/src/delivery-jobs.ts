import { z } from 'zod/v3';

import { RuntimeSchema } from './runtime.js';

/** External coding jobs track delivery separately from requirement verification. */
export const CodingJobSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string(),
    baselineId: z.string(),
    repositoryId: z.string(),
    repository: z.string(),
    worktree: z.string(),
    branch: z.string(),
    baseBranch: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    runtime: RuntimeSchema,
    model: z.string().optional(),
    status: z.enum([
      'running',
      'needs_input',
      'failed',
      'interrupted',
      'awaiting_merge',
      'awaiting_deployment',
      'verifying',
      'verified',
      'failing',
      'unverified',
      'stale',
    ]),
    message: z.string(),
    sessionId: z.string().optional(),
    pullRequestUrl: z.string().optional(),
    mergeSha: z.string().optional(),
    deploymentRevision: z.string().optional(),
    verificationRunId: z.string().optional(),
    nextCheckAt: z.string().optional(),
    checks: z.array(z.string()).default([]),
    error: z.string().optional(),
  })
  .strict();
/** Persisted external-agent job, never a claim that the requirement is done. */
export type CodingJob = z.infer<typeof CodingJobSchema>;
/** Public beta configuration; the revision endpoint returns JSON containing the full deployed commit SHA. */
export const BetaSettingsSchema = z
  .object({
    codingAgentEnabled: z.boolean().optional(),
    enabled: z.boolean().default(false),
    intervalMinutes: z.union([z.literal(60), z.literal(1440)]).default(60),
    revisionUrl: z.string().url().max(2000).optional(),
  })
  .strict();
/** Per-project schedule for verifying the deployed beta after merge. */
export type BetaSettings = z.infer<typeof BetaSettingsSchema>;
/** Claude's report is a delivery claim, independently checked against GitHub before scheduling beta. */
export const CodingResultSchema = z
  .object({
    outcome: z.enum(['ready', 'needs_input']),
    summary: z.string().min(1).max(3000),
    pullRequestUrl: z.string().nullable(),
    localChecks: z.array(z.string().max(500)).max(30),
  })
  .strict();
