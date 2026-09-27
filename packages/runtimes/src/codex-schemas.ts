import { z } from 'zod/v3';

// Parse only the fields consumed by Aiden; additive provider fields remain compatible.
export const accountSchema = z.object({ account: z.object({ type: z.string() }).nullable() });
export const loginSchema = z.object({ authUrl: z.string().url().optional() });
export const modelPageSchema = z.object({
  data: z.array(
    z.object({
      model: z.string().min(1),
      displayName: z.string().optional(),
      hidden: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});
export const configSchema = z.object({
  config: z.object({
    mcp_servers: z.record(z.unknown()).optional(),
  }),
});
export const threadSchema = z.object({ thread: z.object({ id: z.string().min(1) }) });
export const serverPageSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      tools: z.record(z.unknown()).default({}),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});
export const itemSchema = z.object({
  threadId: z.string(),
  item: z.object({
    type: z.string(),
    text: z.string().optional(),
  }),
});
export const turnSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    status: z.string(),
    error: z.object({ message: z.string() }).nullable().optional(),
  }),
});
