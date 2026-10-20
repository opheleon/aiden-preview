import { z } from 'zod/v3';

import type { Call } from './index.js';

/** Where people get help outside the app; shared by the sidebar and the project Guide. */
export const helpLinks = {
  slack:
    'https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw',
  releases: 'https://github.com/opheleon/aiden-preview/releases',
} as const;

/** The setup steps every project walks through, in order. */
export const SetupStepIdSchema = z.enum([
  'understand',
  'confirm',
  'code',
  'verify',
  'first-check',
  'extras',
]);
/** One setup step's identifier. */
export type SetupStepId = z.infer<typeof SetupStepIdSchema>;

/** How a project's work can be checked; manual is always offered last. */
export const VerifyMethodSchema = z.enum(['code', 'web', 'api', 'phone', 'manual']);
/** One way to check the work. */
export type VerifyMethod = z.infer<typeof VerifyMethodSchema>;

/**
 * Inline cards the Guide can attach to a reply. Each one is a real setup control the renderer
 * draws from saved project state, so a card never carries values the person did not confirm.
 */
export const GuideWidgetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm-requirements') }).strict(),
  /** What code is connected, with a way to continue without code. */
  z.object({ type: z.literal('connect-code') }).strict(),
  z
    .object({ type: z.literal('verify-options'), recommended: VerifyMethodSchema.optional() })
    .strict(),
  z.object({ type: z.literal('choose-folder') }).strict(),
  z.object({ type: z.literal('web-check'), url: z.string().url().max(2000).optional() }).strict(),
  z.object({ type: z.literal('api-check'), url: z.string().url().max(2000).optional() }).strict(),
  z.object({ type: z.literal('phone-check') }).strict(),
  z.object({ type: z.literal('manual-check') }).strict(),
  z.object({ type: z.literal('run-check') }).strict(),
  z.object({ type: z.literal('link'), link: z.enum(['slack', 'help']) }).strict(),
]);
/** One inline setup card. */
export type GuideWidget = z.infer<typeof GuideWidgetSchema>;

/** Collapse legacy method cards into one setup form while keeping distinct help links. */
export function distinctGuideWidgets(widgets: GuideWidget[]): GuideWidget[] {
  const setup = new Set([
    'verify-options',
    'choose-folder',
    'web-check',
    'api-check',
    'phone-check',
    'manual-check',
  ]);
  const seen = new Set<string>();
  return widgets.filter((widget) => {
    const key =
      widget.type === 'link'
        ? `link:${widget.link}`
        : setup.has(widget.type)
          ? 'setup'
          : widget.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Setup changes the Guide makes for the person. Aiden applies each one through the same engine
 * functions Settings uses, and only when the person stated the value or asked for the change.
 */
export const GuideActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm-requirements') }).strict(),
  z.object({ type: z.literal('answer-clarification'), callId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('save-web-check'), url: z.string().url().max(2000) }).strict(),
  z
    .object({
      type: z.literal('save-api-check'),
      url: z.string().url().max(2000),
      allowMutations: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('set-manual'), manual: z.boolean() }).strict(),
  z
    .object({ type: z.literal('update-intent'), context: z.string().trim().min(1).max(20000) })
    .strict(),
  z.object({ type: z.literal('run-check') }).strict(),
  /** Size the work again from the agreed requirements and the latest code check. */
  z.object({ type: z.literal('re-estimate') }).strict(),
  /**
   * Copy repositories from one GitHub account into the project, read-only. An empty list means
   * all of the account's active repositories, newest first, up to a cap.
   */
  z
    .object({
      type: z.literal('connect-repositories'),
      owner: z
        .string()
        .trim()
        .regex(/^[\w.-]+$/)
        .max(100),
      repositories: z
        .array(
          z
            .string()
            .trim()
            .regex(/^[\w.-]+$/)
            .max(100),
        )
        .max(30),
    })
    .strict(),
  z.object({ type: z.literal('skip-step'), step: SetupStepIdSchema }).strict(),
]);
/** One setup change the Guide asked Aiden to make. */
export type GuideAction = z.infer<typeof GuideActionSchema>;

/**
 * Up to five short, ordered steps that follow an answer, each naming the control to use.
 * Example: ["Open Settings, then Model.", "Select Sign in with Claude."].
 */
export const GuideNextStepsSchema = z.array(z.string().trim().min(1).max(200)).max(5);

/**
 * A finished check saved into the conversation, so its outcome stays in the thread after later
 * checks or scope changes replace the live results. One item per requirement or criterion.
 * Example: { kind: 'app', runId: 'r1', items: [{ requirementId: 'REQ-1', label: 'Books list', status: 'passed' }] }.
 */
export const GuideCheckResultSchema = z
  .object({
    kind: z.enum(['app', 'code']),
    runId: z.string().min(1).max(200),
    items: z
      .array(
        z
          .object({
            requirementId: z.string().min(1).max(100),
            label: z.string().trim().min(1).max(400),
            status: z.enum(['passed', 'failed', 'unverified']),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
/** One saved check result. */
export type GuideCheckResult = z.infer<typeof GuideCheckResultSchema>;

/**
 * One line in a project's Guide conversation. `event` lines are facts the app wrote, such as a
 * saved URL or a finished check, so the Guide always knows what changed outside the chat.
 */
export const GuideMessageSchema = z
  .object({
    at: z.string().datetime(),
    from: z.enum(['you', 'aiden', 'event']),
    text: z.string().trim().min(1).max(4000),
    widgets: z.array(GuideWidgetSchema).max(4).optional(),
    nextSteps: GuideNextStepsSchema.optional(),
    result: GuideCheckResultSchema.optional(),
  })
  .strict();
/** One Guide message. */
export type GuideMessage = z.infer<typeof GuideMessageSchema>;

/** Most messages a Guide thread keeps; compaction normally keeps it well below this. */
export const maxGuideMessages = 120;

/** A project's single, long-lived Guide thread; older messages are condensed into `summary`. */
export const GuideThreadSchema = z
  .object({
    summary: z.string().max(6000).optional(),
    messages: z.array(GuideMessageSchema).max(maxGuideMessages),
  })
  .strict();
/** A project's Guide thread. */
export type GuideThread = z.infer<typeof GuideThreadSchema>;

/** Setup facts no other file records: which requirements were confirmed, and skipped steps. */
export const SetupStateSchema = z
  .object({
    baselineId: z.string().min(1).optional(),
    requirementsConfirmedAt: z.string().datetime().optional(),
    skipped: z.array(SetupStepIdSchema).default([]),
    /** The newest finished check the Guide has already announced in its thread. */
    announcedRunId: z.string().min(1).optional(),
    /** When the person confirmed how Aiden checks the work, so connected code alone never skips it. */
    checksConfirmedAt: z.string().datetime().optional(),
    /** Successful access checks, keyed by method and bound to the exact saved public target. */
    verifiedTargets: z.record(z.string()).optional(),
  })
  .strict();
/** Saved setup state. */
export type SetupState = z.infer<typeof SetupStateSchema>;

/** Everything setup progress is derived from; all of it is read from saved project files. */
export type SetupFacts = {
  baselineId: string | null;
  state: SetupState;
  repositories: number;
  url: string | null;
  api: boolean;
  phone: boolean;
  manual: boolean;
  completedChecks: number;
  trackerLinked: boolean;
  /** Methods with access evidence for the current configuration; omitted by older callers. */
  readyMethods?: VerifyMethod[];
  /** Unresolved scope keeps setup in the conversation before confirmation. */
  clarificationCount?: number;
  /** Saved answers have not been incorporated into the baseline yet. */
  requirementsPending?: boolean;
};

/** One step as the checklist shows it. */
export type SetupStep = {
  id: SetupStepId;
  label: string;
  status: 'done' | 'next' | 'todo' | 'skipped';
  detail: string;
};

/** The checklist, the first unfinished required step, and whether setup is complete. */
export type SetupProgress = { steps: SetupStep[]; next: SetupStepId | null; complete: boolean };

/** The verification methods a project has saved, in the order the Guide offers them. */
export function savedMethods(facts: SetupFacts): VerifyMethod[] {
  const methods: VerifyMethod[] = [];
  if (facts.repositories) methods.push('code');
  if (facts.url) methods.push('web');
  if (facts.api) methods.push('api');
  if (facts.phone) methods.push('phone');
  if (facts.manual) methods.push('manual');
  return methods;
}

/** Plain names for verification methods, for checklist details and Guide replies. */
export const methodNames: Record<VerifyMethod, string> = {
  code: 'code check',
  web: 'web check',
  api: 'API check',
  phone: 'iPhone check',
  manual: 'manual check',
};

/** Explain the understanding stage while questions or a scope rewrite are still pending. */
function understandingDetail(facts: SetupFacts): string {
  if (facts.clarificationCount) return 'Answer the questions in this chat.';
  if (facts.requirementsPending) return 'Updating the requirements with your answers.';
  return facts.baselineId ? 'Requirements written.' : 'Reading what you sent.';
}

/** Confirmation only applies to settled scope and the exact current baseline. */
function requirementsConfirmed(facts: SetupFacts): boolean {
  return (
    !facts.clarificationCount &&
    !facts.requirementsPending &&
    !!facts.baselineId &&
    facts.state.baselineId === facts.baselineId &&
    !!facts.state.requirementsConfirmedAt
  );
}

/** The one-line detail each setup step shows for the saved facts. */
function stepDetails(
  facts: SetupFacts,
  methods: VerifyMethod[],
  done: Record<SetupStepId, boolean>,
): Record<SetupStepId, string> {
  return {
    understand: understandingDetail(facts),
    confirm: done.confirm ? 'You confirmed the requirements.' : 'Check that Aiden understood you.',
    code: facts.repositories
      ? `${facts.repositories} ${facts.repositories === 1 ? 'repository' : 'repositories'} connected.`
      : 'Paste your GitHub repositories so Aiden can estimate the work.',
    verify:
      methods.length && !done.verify
        ? methods.every((m) => m === 'code')
          ? 'Code checks are on. Choose any other checks, then confirm.'
          : 'Check access to the selected verification methods.'
        : methods.length
          ? `Using ${methods.map((m) => methodNames[m]).join(', ')}.`
          : 'Choose how Aiden checks the work.',
    'first-check': facts.completedChecks
      ? `${facts.completedChecks} ${facts.completedChecks === 1 ? 'check' : 'checks'} finished.`
      : 'Run the first check.',
    extras: facts.trackerLinked ? 'Ticket tracker linked.' : 'Optional: link a ticket tracker.',
  };
}

/**
 * Derive setup progress from saved facts only, so setup resumes wherever the person left it, even
 * after changing something in Settings. Confirmation counts only for the current requirements.
 * Example: a project with confirmed requirements and no method has `next` set to `verify`.
 */
export function setupProgress(facts: SetupFacts): SetupProgress {
  const skipped = new Set(facts.state.skipped);
  const methods = savedMethods(facts);
  const scopeReady = !facts.clarificationCount && !facts.requirementsPending;
  const confirmed = requirementsConfirmed(facts);
  const ready =
    methods.length > 0 &&
    methods.every((method) => !facts.readyMethods || facts.readyMethods.includes(method));
  // Connected code alone is not a testing decision: checks count once the person confirms them
  // or saves another way to check, even after a code check has already run.
  const chosen = !!facts.state.checksConfirmedAt || methods.some((method) => method !== 'code');
  const done: Record<SetupStepId, boolean> = {
    understand: !!facts.baselineId && scopeReady,
    confirm: confirmed,
    code: facts.repositories > 0,
    verify: ready && chosen,
    'first-check':
      facts.completedChecks > 0 || (methods.length > 0 && methods.every((m) => m === 'manual')),
    extras: facts.trackerLinked,
  };
  const details = stepDetails(facts, methods, done);
  const labels: Record<SetupStepId, string> = {
    understand: 'Define goal',
    confirm: 'Review requirements',
    code: 'Connect code',
    verify: 'Choose checks',
    'first-check': 'First check',
    extras: 'Ticket tracker',
  };
  const order = SetupStepIdSchema.options;
  const required = order.filter((id) => id !== 'extras');
  const next = required.find((id) => !done[id] && !skipped.has(id)) ?? null;
  const steps = order.map((id) => ({
    id,
    label: labels[id],
    detail: details[id],
    status: done[id]
      ? ('done' as const)
      : skipped.has(id)
        ? ('skipped' as const)
        : id === next
          ? ('next' as const)
          : ('todo' as const),
  }));
  return { steps, next, complete: next === null };
}

/** What the Guide tab loads: the conversation and the checklist it drives. */
export type GuideView = {
  thread: GuideThread;
  setup: SetupProgress;
  /** Current questions, separate from historical conversation text. */
  clarifications?: Call[];
  /** Confirmation waits until saved answers have been incorporated. */
  requirementsPending?: boolean;
};
