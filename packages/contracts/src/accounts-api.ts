import { z } from 'zod/v3';

import { AccountExecutionSchema } from './accounts-execution.js';
import { type QuestionScope, type WorkRole, workRoles } from './work-roles.js';

/**
 * Wire contract for the Accounts API used by the Teams tier.
 * Vendored from the private aiden-teams server (src/http/schemas.ts and src/http/views.ts at
 * the task board revision: work roles, review, and verification). Response schemas are strict so
 * drift fails tests/accounts-contract.test.ts, which parses the server's example responses copied
 * into packages/contracts/fixtures/accounts. Fields the task board added default when a server
 * from before it leaves them out, so this app keeps working while the server rolls out.
 */

const iso = z.string().datetime();
const role = z.enum(workRoles);
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

/** One check on reviewed work. Automated checks settle on their own; manual ones need a person. */
export const TaskCheckSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['automated', 'manual']),
    state: z.enum(['pending', 'passed', 'failed']),
    detail: z.string().nullable(),
    url: z.string().nullable(),
  })
  .strict();

/** When an agent task entered each stage; null for a stage it has not reached. */
const TimelineSchema = z
  .object({
    startedAt: iso.nullable().default(null),
    reviewAt: iso.nullable().default(null),
    verifyAt: iso.nullable().default(null),
    finishedAt: iso.nullable().default(null),
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
    /**
     * Agent work a person must look at waits in `review` with its reviewer, then in `verify`
     * while its checks run. Nothing moves backwards: a failed check or a change request closes the
     * task and the server queues a linked fix task.
     */
    status: z.enum([
      'queued',
      'leased',
      'blocked',
      'review',
      'verify',
      'done',
      'failed',
      'cancelled',
    ]),
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
    /** The kind of work, which decides who reviews it and who answers its questions. */
    role: role.nullable().default(null),
    /** The one member who reviews an agent task and owns its questions. */
    reviewerUserId: z.string().nullable().default(null),
    /** The agent task a question or verification run belongs to. */
    parentTaskId: z.string().nullable().default(null),
    /** The task this one fixes, so each revision traces back to the one before. */
    revisionOf: z.string().nullable().default(null),
    /** How finished reviewed work ended. */
    verification: z.enum(['passed', 'failed', 'changes_requested']).nullable().default(null),
    /** What the reviewer looks at: the agent's summary and the pull requests it opened. */
    review: z
      .object({ summary: z.string(), pullRequestUrls: z.array(z.string()) })
      .strict()
      .nullable()
      .default(null),
    checks: z.array(TaskCheckSchema).default([]),
    timeline: TimelineSchema.default({}),
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
          /** Work roles the member holds; reviews and questions are routed by them. */
          roles: z.array(role).default([]),
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

/** A task in an account's queue. */
export type AccountTask = z.infer<typeof AccountTaskSchema>;
/** A server-side project. */
export type AccountProject = z.infer<typeof AccountProjectSchema>;
/** The allocator's answer. */
export type Decision = z.infer<typeof DecisionSchema>;
/** The account work screen's data. */
export type AccountState = z.infer<typeof AccountStateSchema>;
/** One check on reviewed work, as the server shows it. */
export type TaskCheck = z.infer<typeof TaskCheckSchema>;

/** One check on reviewed work as a machine reports it; the server gives it an id. */
export interface CheckInput {
  /** Up to 200 characters, for example `CI: acme/api#12` or `REQ-3: Members sign in`. */
  name: string;
  kind: TaskCheck['kind'];
  state: TaskCheck['state'];
  /** Up to 500 characters: what failed, or what a person should look at. */
  detail?: string | null;
  url?: string | null;
}

/**
 * What an agent hands its reviewer when it completes: the task goes to review instead of done.
 * At most 20 pull requests and 50 checks; the summary is at most 8000 characters.
 */
export interface ReviewPacket {
  summary: string;
  pullRequestUrls: string[];
  checks: CheckInput[];
}

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
  /** The kind of work, classified when the task is created. */
  role?: WorkRole;
  /** For a question a person answers: about this task (its reviewer) or general (a lead). */
  scope?: QuestionScope;
}
