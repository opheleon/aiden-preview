import { z } from 'zod/v3';

const text = z.string().trim().min(1).max(200);
const connectionId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
/** One explicit external destination; changing it cannot silently duplicate already published issues. */
export const TicketDestinationSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('linear'), connectionId, team: text, project: text }).strict(),
  z
    .object({
      provider: z.literal('jira'),
      connectionId,
      cloudId: text,
      projectKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      issueTypeName: text,
    })
    .strict(),
]);
/** Provider-specific destination selected by the user. */
export type TicketDestination = z.infer<typeof TicketDestinationSchema>;
/** The exact reviewed issue tools; no arbitrary MCP writes are exposed to analyst agents. */
export const TicketToolsSchema = z
  .object({ create: text, update: text, get: text, search: text })
  .strict();
/** Ticket-only operation names pinned to discovered contracts. */
export type TicketTools = z.infer<typeof TicketToolsSchema>;
/** Project-level authorization to automatically create and maintain ticket content. */
export const TicketSettingsSchema = z
  .object({
    enabled: z.boolean(),
    destination: TicketDestinationSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    tools: TicketToolsSchema,
  })
  .strict();
/** Saved per-project ticket authorization. */
export type TicketSettings = z.infer<typeof TicketSettingsSchema>;
/** Remote status is an observation, never evidence that acceptance criteria passed. */
export const TicketRecordSchema = z
  .object({
    featureId: text,
    marker: text,
    title: z.string(),
    state: z.enum(['pending', 'synced', 'conflict', 'uncertain', 'error', 'retired']),
    issueId: z.string().optional(),
    url: z.string().url().optional(),
    remoteStatus: z.string().optional(),
    remoteStatusType: z.string().optional(),
    remoteStatusChangedAt: z.string().datetime().optional(),
    assignee: z.string().optional(),
    contentHash: z.string().optional(),
    observedHash: z.string().optional(),
    pendingHash: z.string().optional(),
    checkedAt: z.string().datetime().optional(),
    message: z.string().optional(),
  })
  .strict();
/** Durable identity and recovery state for a single feature ticket. */
export type TicketRecord = z.infer<typeof TicketRecordSchema>;
/** Durable project identity makes a retry reuse the same Linear project after an uncertain write. */
export const LinearProjectLinkSchema = z
  .object({
    connectionId,
    teamId: text,
    teamName: text.optional(),
    name: text,
    marker: text,
    state: z.enum(['pending', 'linked']),
    id: text.optional(),
    url: z.string().url().optional(),
  })
  .strict();
/** Aiden-owned Linear project, including recovery state before read-back succeeds. */
export type LinearProjectLink = z.infer<typeof LinearProjectLinkSchema>;
/** Team names are loaded from the selected authenticated connection. */
export interface LinearTeam {
  id: string;
  name: string;
}
/** Latest ticket state, also returned to the desktop without credentials or raw external output. */
export const TicketStateSchema = z
  .object({
    settings: TicketSettingsSchema.nullable(),
    linearProject: LinearProjectLinkSchema.optional(),
    externalChangeAt: z.string().datetime().optional(),
    needsAssessment: z.boolean().optional(),
    records: z.array(TicketRecordSchema),
    error: z.string().optional(),
    checkedAt: z.string().datetime().optional(),
  })
  .strict();
/** Public project ticket state. */
export type TicketState = z.infer<typeof TicketStateSchema>;
/** Normalized provider data used for identity, scope, and content read-back checks. */
export interface RemoteTicket {
  id: string;
  title: string;
  description: string;
  url?: string;
  status?: string;
  statusType?: string;
  assignee?: string;
  project: string;
  team?: string;
}
