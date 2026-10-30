import { z } from 'zod/v3';

import { questionScopes, workRoles } from './work-roles.js';

/** Runner budgets supplied by Teams; status reports do not refresh these limits. */
export const ExecutionLimitsSchema = z
  .object({
    idleMs: z.number().int().positive(),
    toolMs: z.number().int().positive(),
    absoluteMs: z.number().int().positive(),
  })
  .strict();

/** Publication identity saved before the runner performs external side effects. */
export const DeliveryCheckpointSchema = z
  .object({
    summary: z.string(),
    checks: z.array(z.string()),
    openQuestions: z
      .array(
        z
          .object({
            question: z.string(),
            assigneeUserId: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    repositories: z.array(
      z
        .object({
          repository: z.string(),
          branch: z.string(),
          baseBranch: z.string(),
          commit: z.string(),
          pullRequestUrl: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** Durable attempt state supplied by the authoritative Teams server. */
export const AccountExecutionSchema = z
  .object({
    attemptId: z.string(),
    location: z.enum(['local', 'cloud']),
    startedAt: z.string().datetime(),
    deadlineAt: z.string().datetime(),
    activityAt: z.string().datetime(),
    activitySequence: z.number().int().nonnegative(),
    reportedAt: z.string().datetime().nullable(),
    reportSequence: z.number().int().nonnegative().optional(),
    reportState: z.enum(['progress', 'question', 'blocked', 'reported_complete']).optional(),
    phase: z.enum(['running', 'publishing', 'interrupted', 'blocked', 'completed']),
    limits: ExecutionLimitsSchema,
    checkpoint: DeliveryCheckpointSchema.nullable(),
  })
  .strict();

/** Agent observations are claims, not proof of completion or execution authority. */
export const AgentStatusSchema = z
  .object({
    state: z.enum(['progress', 'question', 'blocked', 'reported_complete']),
    message: z.string().trim().min(1).max(500),
    question: z.string().trim().min(1).max(5000).optional(),
    assigneeUserId: z.string().min(1).max(64).optional(),
    /** Who can answer a question: product_manager, be_engineer, or fe_engineer. */
    role: z
      .enum(workRoles)
      .optional()
      .describe('For a question: the work role that can answer it.'),
    /** task when the question is about this slice; general for product or cross-team questions. */
    scope: z
      .enum(questionScopes)
      .optional()
      .describe(
        'For a question: task when it is about this slice, general for product or cross-team questions.',
      ),
  })
  .strict();

/** One status report from an external coding agent. */
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
/** Committed metadata that can be reconciled after a lost acknowledgement. */
export type DeliveryCheckpoint = z.infer<typeof DeliveryCheckpointSchema>;
/** Execution limits for an unattended task. */
export type ExecutionLimits = z.infer<typeof ExecutionLimitsSchema>;

/** Runner-observed activity, kept separate from model-authored status messages. */
export type ExecutionActivity =
  { type: 'output' } | { type: 'tool-start'; id: string } | { type: 'tool-end'; id: string };
