import { z } from 'zod/v3';

import { edgeCaseId, requirementId } from './ids.js';

/**
 * What Aiden did: started a look, checked something, found a problem, decided, asked, handed off,
 * or concluded. A `step` is one concrete action inside a run, such as reading a file or clicking
 * a button; steps make up a run's full history but stay out of the brief.
 */
export const ActivityKindSchema = z.enum([
  'look',
  'check',
  'find',
  'decide',
  'ask',
  'dispatch',
  'result',
  'step',
]);

/**
 * One line of the per-run action log, written where the decision happened. `reason` answers "why did you
 * do this?", and `evidence` names the verification item whose recording backs the line.
 */
export const ActivityEntrySchema = z
  .object({
    at: z.string().datetime(),
    runId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    kind: ActivityKindSchema,
    requirementId: requirementId.optional(),
    edgeCaseId: edgeCaseId.optional(),
    summary: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(600).optional(),
    evidence: z
      .string()
      .regex(/^REQ-[1-9]\d*(-E[1-9]\d*)?$/)
      .optional(),
    reconstructed: z.literal(true).optional(),
  })
  .strict();
/** Parsed action-log entry. */
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
/** Kind of action recorded in the log. */
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/**
 * One message in a run's "Why?" conversation. `log` answers are the reason Aiden recorded when it
 * acted; `model` answers were written afterwards from the run's saved record.
 */
export const ChatMessageSchema = z
  .object({
    at: z.string().datetime(),
    from: z.enum(['you', 'aiden']),
    text: z.string().trim().min(1).max(2000),
    source: z.enum(['log', 'model']).optional(),
  })
  .strict();
/** Parsed chat message. */
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
/** A run's conversation, oldest first. */
export const ChatSchema = z.array(ChatMessageSchema).max(200);
