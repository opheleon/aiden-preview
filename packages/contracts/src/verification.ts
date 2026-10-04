import { z } from 'zod/v3';

/** An explicitly selected API; writes require a disposable test environment. */
export const ApiVerificationSchema = z
  .object({
    url: z.string().url().max(2000),
    allowMutations: z.boolean().default(false),
  })
  .strict();

/** Worker-only settings file; test credentials stay in the worker and never enter run output. */
export const VerificationConfigSchema = z
  .object({
    /** The project's app URL, saved from Settings or the CLI; its origin counts as configured. */
    url: z.string().url().max(2000).optional(),
    api: ApiVerificationSchema.optional(),
    allowedOrigins: z.array(z.string().url()).max(20).default([]),
    credentials: z
      .object({ username: z.string().min(1).max(500), password: z.string().min(1).max(500) })
      .strict()
      .optional(),
    /**
     * An optional fixture token the project owner confirms is genuinely expired and still
     * properly signed, so the API agent can test expiry rejection without forging a signature.
     */
    expiredToken: z.string().min(1).max(4000).optional(),
    stepLimit: z.number().int().min(5).max(60).default(25),
  })
  .strict();
/** Parsed verification settings with defaults applied. */
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;
/** Verification settings safe to show in the renderer; test credentials are never included. */
export type VerificationSettings = {
  url: string | null;
  api?: z.infer<typeof ApiVerificationSchema>;
};

/** Model-selected reasons a criterion cannot be checked; Aiden adds its own reasons in verdicts. */
export const AgentUnverifiedReasonSchema = z.enum([
  'not_testable_in_ui',
  'blocked',
  'destructive',
  'needs_credentials',
  'other',
]);

/** Every reason a verdict can be "Couldn't verify", each with a fixed plain-language label. */
export const UnverifiedReasonSchema = z.enum([
  ...AgentUnverifiedReasonSchema.options,
  'step_limit',
  'signals_disagree',
  'inconsistent_results',
  'no_evidence',
]);
/** Why a criterion could not be verified. */
export type UnverifiedReason = z.infer<typeof UnverifiedReasonSchema>;

/** Final answer from one browser session; it cites a recorded page check instead of asserting a pass. */
export const CriterionOutcomeSchema = z
  .object({
    outcome: z.enum(['pass', 'fail', 'unverified']),
    unverifiedReason: AgentUnverifiedReasonSchema.nullable(),
    explanation: z.string().trim().min(1).max(400),
    expected: z.string().trim().max(300).nullable(),
    observed: z.string().trim().max(300).nullable(),
    proofCheck: z.number().int().min(1).nullable(),
  })
  .strict();
/** Browser agent result for one attempt, before Aiden applies evidence rules. */
export type CriterionOutcome = z.infer<typeof CriterionOutcomeSchema>;

/** Independent screenshot judgment; the vision reviewer never sees the browser agent's reasoning. */
export const VisionJudgmentSchema = z
  .object({
    judgment: z.enum(['satisfied', 'not_satisfied', 'unclear']),
    observation: z.string().trim().min(1).max(300),
  })
  .strict();
/** What the screenshot reviewer concluded. */
export type VisionJudgment = z.infer<typeof VisionJudgmentSchema>;

/** Roles the browser tools can target; `text` matches visible text instead of an ARIA role. */
export const TargetRoleSchema = z.enum([
  'alert',
  'button',
  'checkbox',
  'combobox',
  'dialog',
  'heading',
  'img',
  'link',
  'listitem',
  'menuitem',
  'option',
  'paragraph',
  'radio',
  'searchbox',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'textbox',
  'text',
]);
/** Accessible element reference used by actions and page checks. */
export type TargetRole = z.infer<typeof TargetRoleSchema>;

/** Page states a structural check can confirm without trusting model judgment. */
export const CheckStateSchema = z.enum([
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'checked',
  'unchecked',
  'has_text',
  'has_value',
]);
/** Expected element state named by a page check. */
export type CheckState = z.infer<typeof CheckStateSchema>;

/** A deterministic check Aiden ran against the live page, with its outlined proof screenshot. */
export type PageCheck = {
  id: number;
  step: number;
  role: TargetRole;
  name: string;
  state: CheckState;
  text: string | null;
  passed: boolean;
  actual: string;
  atMs: number;
  screenshot: string;
};

/** One logged loop iteration: the action taken, why, and what the page looked like afterwards. */
export type VerificationStep = {
  index: number;
  action: string;
  reasoning: string;
  result: string;
  url: string;
  atMs: number;
  screenshot: string | null;
};

/** Verdict labels shown to readers. */
export type Verdict = 'pass' | 'fail' | 'unverified';

/** One fresh browser session for a criterion, with its own video and evidence. */
export type VerificationAttempt = {
  attempt: number;
  verdict: Verdict;
  reason: UnverifiedReason | null;
  explanation: string;
  expected: string | null;
  observed: string | null;
  video: string;
  proof: PageCheck | null;
  vision: VisionJudgment | null;
  steps: VerificationStep[];
};

/** Final per-criterion result after evidence rules and the single retry. */
export type CriterionResult = {
  /** API recordings show the request ledger rather than the application UI. */
  method?: 'app' | 'api';
  requirementId: string;
  /** Set when this result checks one edge case of the requirement rather than its main path. */
  edgeCaseId?: string | null;
  /** Who Aiden acted as, when the plan named someone. */
  persona?: string | null;
  criterion: string;
  verdict: Verdict;
  reason: UnverifiedReason | null;
  explanation: string;
  expected: string | null;
  observed: string | null;
  decisiveAttempt: number | null;
  attempts: VerificationAttempt[];
};

/** Counts behind the report summary line; also carried by the worker's completed event. */
export const VerificationSummarySchema = z
  .object({
    total: z.number().int().min(0),
    verified: z.number().int().min(0),
    failed: z.number().int().min(0),
    unverified: z.number().int().min(0),
    line: z.string(),
  })
  .strict();
/** Parsed verification summary. */
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;

/** Persisted verification result for one project run; media paths are relative to its folder. */
export type VerificationResult = {
  environment?: 'beta';
  deploymentRevision?: string;
  /** True while the run is still producing evidence; absent on completed legacy results. */
  partial?: boolean;
  schemaVersion: '1.0';
  runId: string;
  projectId: string;
  projectName: string;
  baselineId: string;
  url: string;
  generatedAt: string;
  runtime: { provider: string; auth: string; model: string | null; version: string };
  criteria: CriterionResult[];
  summary: VerificationSummary;
  /** How Aiden decided to check each requirement and edge case; absent on results saved before planning existed. */
  triage?: TriageItem[];
};

/**
 * How to check one requirement or edge case, decided the way a person would: in the running app when a
 * user can see it, in the code when they cannot, or by a person when it happens outside software.
 */
export const TriageItemSchema = z
  .object({
    requirementId: z.string().regex(/^REQ-[1-9]\d*$/),
    edgeCaseId: z
      .string()
      .regex(/^E[1-9]\d*$/)
      .nullable(),
    method: z.enum(['app', 'api', 'code', 'person']),
    persona: z.string().trim().min(1).max(120).nullable(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
/** One planned check. */
export type TriageItem = z.infer<typeof TriageItemSchema>;
/** Model output for the check plan. */
export const TriageSchema = z.object({ items: z.array(TriageItemSchema).max(300) }).strict();
