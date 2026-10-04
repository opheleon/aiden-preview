import { z } from 'zod/v3';

/** A person's acceptance is a decision about saved evidence, never a verification result. */
export const OutcomeAcceptanceSchema = z
  .object({
    at: z.string().datetime(),
    note: z.string().trim().min(1).max(2000),
    evidenceKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
/** Durable project decisions; legacy projects have an active lifecycle with no decisions. */
export const ProjectLifecycleSchema = z
  .object({
    status: z.enum(['active', 'closed']),
    acceptance: OutcomeAcceptanceSchema.optional(),
    history: z.array(
      z
        .object({
          at: z.string().datetime(),
          action: z.enum(['accepted', 'closed', 'reopened']),
          note: z.string().max(2000),
          evidenceKey: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
/** Read model adds whether the saved acceptance still describes the current scope and evidence. */
export const ProjectLifecycleViewSchema = ProjectLifecycleSchema.extend({
  acceptanceCurrent: z.boolean(),
  evidenceKey: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Persisted human decisions, maintained independently from project inputs and assessment artifacts. */
export type ProjectLifecycle = z.infer<typeof ProjectLifecycleSchema>;
