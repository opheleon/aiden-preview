import { z } from 'zod/v3';

import { AccountExecutionSchema } from './accounts-execution.js';

/**
 * Wire contract for the Accounts API used by the Teams tier.
 * Vendored from the private aiden-teams server (src/http/schemas.ts and src/http/views.ts at
 * the Auth0 sign-in revision). Response schemas are strict so drift fails tests/accounts-contract.test.ts, which
 * parses the server's example responses copied into packages/contracts/fixtures/accounts.
 */

const iso = z.string().datetime();
const runtime = z
  .object({ provider: z.enum(['claude', 'codex']), auth: z.enum(['subscription', 'apiKey']) })
  .strict();

/** Tools a machine verifies before asking for work. */
export const accountToolNames = ['git', 'gh', 'claude', 'codex', 'playwright'] as const;
/** Integration connections a machine can report. */
export const accountConnectionNames = ['linear', 'jira', 'notion'] as const;

/** A signed-in person as the server shows them. */
export const AccountsUserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    avatar: z.string().nullable().optional(),
    slack: z
      .object({
        userId: z.string(),
        workspaceId: z.string(),
        userName: z.string(),
        workspaceName: z.string(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

/** A team, with the publishers whose installed apps its members may test (empty allows any). */
export const AccountSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    allowedPublishers: z.array(z.string().max(200)).max(50).optional(),
    createdAt: iso.optional(),
  })
  .strict();

/** The signed-in person and their accounts. */
export const MeSchema = z
  .object({ user: AccountsUserSchema, accounts: z.array(AccountSummarySchema) })
  .strict();

/** An invite link. */
export const InviteSchema = z
  .object({ code: z.string(), link: z.string(), expiresAt: iso })
  .strict();

/** Result of changing a member's team admin access. */
export const MemberAdminSchema = z.object({ isAdmin: z.boolean() }).strict();

/** What a machine needs before it can be offered a task. */
export const TaskRequirementsSchema = z
  .object({
    tools: z.array(z.enum(accountToolNames)),
    connections: z.array(z.enum(accountConnectionNames)),
    runtime: runtime.nullable(),
    pinnedUserId: z.string().nullable(),
    pinnedDeviceId: z.string().nullable(),
  })
  .strict();

/** A task in an account's queue. */
export const AccountTaskSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    projectId: z.string(),
    actor: z.enum(['agent', 'human']),
    kind: z.string(),
    title: z.string(),
    instructions: z.string(),
    requirementIds: z.array(z.string()),
    requires: TaskRequirementsSchema,
    status: z.enum(['queued', 'leased', 'blocked', 'done', 'failed', 'cancelled']),
    blockedBy: z.string().nullable(),
    assigneeUserId: z.string().nullable(),
    leasedDeviceId: z.string().nullable(),
    leaseExpiresAt: iso.nullable(),
    attempts: z.number().int(),
    execution: AccountExecutionSchema.nullable().optional(),
    result: z.unknown(),
    resume: z.unknown(),
    queuedAt: iso,
    updatedAt: iso,
    waiting: z.string().nullable().optional(),
    /** The last thing a running task reported, for example "Running pytest". */
    progress: z.string().nullable().optional(),
  })
  .strict();

/** A project with its opaque, client-owned document. */
export const AccountProjectSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    name: z.string(),
    runtime,
    document: z.unknown(),
    revision: z.number().int().min(1),
    status: z.enum(['active', 'closed']),
    createdAt: iso,
    updatedAt: iso,
  })
  .strict();

/** The allocator's answer; reasons are plain language for the member. */
export const DecisionSchema = z.union([
  z.object({ type: z.literal('assign'), reason: z.string() }).strict(),
  z
    .object({
      type: z.literal('hold'),
      code: z.string(),
      reason: z.string(),
      pollAfterSeconds: z.number().int().positive(),
    })
    .strict(),
]);

/** Answer to "what should this machine do next". */
export const WorkAnswerSchema = z
  .object({
    decision: DecisionSchema,
    task: AccountTaskSchema.nullable(),
    project: AccountProjectSchema.nullable(),
  })
  .strict();

/** Where the team wakes this machine when it sleeps between tasks; null once it stopped asking. */
export const WakeHookSchema = z
  .object({ deviceId: z.string(), url: z.string().url().nullable() })
  .strict();

/** A project plus the tasks queued with it. */
export const ProjectCreatedSchema = z
  .object({ project: AccountProjectSchema, tasks: z.array(AccountTaskSchema) })
  .strict();

/** One line of a task's feedback log. */
export const TaskEventSchema = z
  .object({ at: iso, kind: z.string(), message: z.string() })
  .strict();

/** Everything the account work screen shows. */
export const AccountStateSchema = z
  .object({
    account: AccountSummarySchema,
    members: z.array(
      z
        .object({
          id: z.string(),
          email: z.string(),
          name: z.string().nullable(),
          avatar: z.string().nullable().optional(),
          role: z.enum(['owner', 'member']),
          isAdmin: z.boolean(),
        })
        .strict(),
    ),
    projects: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          revision: z.number().int(),
          status: z.enum(['active', 'closed']),
        })
        .strict(),
    ),
    tasks: z.array(AccountTaskSchema),
    devices: z.array(
      z
        .object({
          deviceId: z.string(),
          name: z.string(),
          owner: z.string(),
          lastSeenAt: iso,
          busy: z.boolean(),
          pickupEnabled: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

/** Error body for every non-2xx response. */
export const ApiErrorSchema = z.object({ error: z.string(), message: z.string() }).strict();

/** The signed-in person and their accounts. */
export type Me = z.infer<typeof MeSchema>;
/** A created project with its first tasks. */
export type ProjectCreated = z.infer<typeof ProjectCreatedSchema>;
/** Answer to a work poll. */
export type WorkAnswer = z.infer<typeof WorkAnswerSchema>;
/** A machine's registered wake address. */
export type WakeHook = z.infer<typeof WakeHookSchema>;

/** A task in an account's queue. */
export type AccountTask = z.infer<typeof AccountTaskSchema>;
/** A server-side project. */
export type AccountProject = z.infer<typeof AccountProjectSchema>;
/** The allocator's answer. */
export type Decision = z.infer<typeof DecisionSchema>;
/** The account work screen's data. */
export type AccountState = z.infer<typeof AccountStateSchema>;

/** Work a machine adds to a project's queue; the server derives runtime and pinning. */
export interface NewAccountTask {
  assigneeUserId?: string;
  actor: 'agent' | 'human';
  kind: string;
  title: string;
  instructions?: string;
  requirementIds?: string[];
  tools?: (typeof accountToolNames)[number][];
  connections?: (typeof accountConnectionNames)[number][];
  usesModel?: boolean;
  pinToCaller?: boolean;
  dedupeKey?: string | null;
}
