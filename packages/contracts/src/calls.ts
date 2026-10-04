import { z } from 'zod/v3';

import { edgeCaseId, requirementId } from './ids.js';

/**
 * A decision Aiden needs from a person. Legacy decisions without a blocking classification
 * conservatively block affected work until answered or explicitly reclassified.
 */
export const CallDraftSchema = z
  .object({
    requirementId: requirementId.nullable(),
    edgeCaseId: edgeCaseId.nullable(),
    question: z.string().trim().min(1).max(400),
    options: z.array(z.string().trim().min(1).max(160)).max(4),
    blocking: z.boolean().optional(),
    assumption: z.string().trim().min(1).max(300),
    owner: z.enum(['you', 'someone else']),
  })
  .strict();
/** Model-proposed call before Aiden records it. */
export type CallDraft = z.infer<typeof CallDraftSchema>;

/** A recorded call: a scope decision, or where the running app can be found. */
export const CallSchema = CallDraftSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  kind: z.enum(['decision', 'app-url']),
  status: z.enum(['open', 'answered', 'dropped']),
  answer: z.string().trim().min(1).max(2000).nullable(),
  askedAt: z.string().datetime(),
  answeredAt: z.string().datetime().nullable(),
  runId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .nullable(),
}).strict();
/** Persisted call in `projects/<id>/calls.json`. */
export type Call = z.infer<typeof CallSchema>;
/** Every call recorded for one project, oldest first. */
export const CallsSchema = z.array(CallSchema).max(500);
