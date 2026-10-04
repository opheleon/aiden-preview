import { z } from 'zod/v3';

export const McpAuthSchema = z.enum(['oauth', 'bearer', 'none']);
export const McpConnectionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().min(1),
    provider: z.enum(['linear', 'custom']),
    url: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith('https://') || value.startsWith('http://127.0.0.1:'),
        'Hosted MCP servers must use HTTPS.',
      ),
    auth: McpAuthSchema,
    clientId: z.string().optional(),
    transport: z.enum(['streamable-http', 'sse']),
    status: z.enum([
      'disconnected',
      'connecting',
      'authorization_required',
      'connected',
      'needs_review',
      'failed',
    ]),
    secureStorage: z.enum(['keyring', 'session', 'none']),
    // Explicit preference is separate from the observed storage fallback.
    sessionOnly: z.boolean().optional(),
    approvedTools: z.array(z.string()),
    toolFingerprint: z.string().optional(),
    lastTestedAt: z.string().datetime().optional(),
    message: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const McpToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    readOnly: z.boolean(),
    approved: z.boolean(),
    reason: z.string(),
  })
  .strict();

export const ProjectSourcesSchema = z
  .object({
    contextConnectionIds: z.array(z.string()),
    history: z
      .object({
        connectionId: z.string(),
        sourceId: z.string(),
        sourceLabel: z.string(),
        historyTool: z.string(),
        sourceArgument: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** Connection authentication mechanism; secrets are stored separately from connection metadata. */
export type McpAuth = z.infer<typeof McpAuthSchema>;
/** Persisted hosted-server metadata and approval fingerprint, excluding bearer tokens and OAuth secrets. */
export type McpConnection = z.infer<typeof McpConnectionSchema>;
/** Discovered tool schema and read-only decision; metadata changes require renewed approval. */
export type McpTool = z.infer<typeof McpToolSchema>;
/** Project-scoped connection consent and optional history selection; global connections are not implicit consent. */
export type ProjectSources = z.infer<typeof ProjectSourcesSchema>;
