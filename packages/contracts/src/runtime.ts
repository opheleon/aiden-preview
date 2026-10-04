import { z } from 'zod/v3';

/** Saved runtime selection shared by projects, runs, and estimation snapshots. */
export const RuntimeSchema = z
  .object({
    provider: z.enum(['codex', 'claude']),
    auth: z.enum(['subscription', 'apiKey']),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  })
  .strict();
