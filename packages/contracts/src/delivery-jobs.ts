import { z } from 'zod/v3';

import { RuntimeSchema } from './runtime.js';
import { questionScopes, workRoles } from './work-roles.js';

/**
 * A coding question requiring review, with optional routing to a known team member, the work role
 * that can answer it, and whether it is about this slice or a general product question.
 */
const CodingQuestionSchema = z
  .object({
    question: z.string().min(1).max(2000),
    assigneeUserId: z.string().max(64).optional(),
    blocking: z.boolean(),
    role: z.enum(workRoles).optional(),
    scope: z.enum(questionScopes).optional(),
  })
  .strict();

const decisionFields = {
  decisions: z.array(z.string().max(1000)).max(30).optional(),
  assumptions: z.array(z.string().max(1000)).max(30).optional(),
  openQuestions: z.array(CodingQuestionSchema).max(20).optional(),
};

/** External coding jobs track delivery separately from requirement verification. */
export const CodingJobSchema = z
  .object({
    ...decisionFields,
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
const resultFields = {
  outcome: z.enum(['ready', 'needs_input']),
  summary: z.string().min(1).max(3000),
  pullRequestUrl: z.string().nullable(),
  localChecks: z.array(z.string().max(500)).max(30),
};
/**
 * What the coding agent is asked to return. Every field is required, with empty lists and null
 * for nothing, because Codex's structured output (strict mode) rejects optional fields.
 */
export const CodingOutputSchema = z
  .object({
    decisions: z.array(z.string().max(1000)).max(30),
    assumptions: z.array(z.string().max(1000)).max(30),
    openQuestions: z
      .array(
        z
          .object({
            question: z.string().min(1).max(2000),
            assigneeUserId: z.string().max(64).nullable(),
            blocking: z.boolean(),
            role: z.enum(workRoles).nullable(),
            scope: z.enum(questionScopes),
          })
          .strict(),
      )
      .max(20),
    ...resultFields,
  })
  .strict();
/**
 * The agent's report as Aiden reads it: a delivery claim, independently checked against GitHub
 * before scheduling beta. Missing lists read as empty, and a null assignee or role as none.
 */
export const CodingResultSchema = z
  .object({
    decisions: z.array(z.string().max(1000)).max(30).default([]),
    assumptions: z.array(z.string().max(1000)).max(30).default([]),
    openQuestions: z
      .array(
        CodingQuestionSchema.extend({
          assigneeUserId: z
            .string()
            .max(64)
            .nullish()
            .transform((id) => id ?? undefined),
          role: z
            .enum(workRoles)
            .nullish()
            .transform((value) => value ?? undefined),
        }),
      )
      .max(20)
      .default([]),
    ...resultFields,
  })
  .strict();
