import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from 'playwright';
import type { z } from 'zod/v3';

import {
  type CriterionOutcome,
  CriterionOutcomeSchema,
  outputSchemaFor,
  type PageCheck,
  type RunManifest,
  type VerificationAttempt,
  type VerificationConfig,
  type VisionJudgment,
  VisionJudgmentSchema,
} from '../../contracts/src/index.js';
import { ArtifactFormatError } from '../../runtimes/src/index.js';
import {
  type LocalToolServer,
  noTools,
  serveTools,
  type ToolProvider,
} from '../../tools/src/mcp.js';
import {
  ApiHttp,
  ApiSession,
  BrowserSession,
  judgeAttempt,
  plainText,
  ProofViewer,
  reviewableProof,
} from '../../verification/src/index.js';
import { recordStep } from './activity.js';
import { workflowRoot } from './model-stage.js';
import type { AppCheck } from './triage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Run-scoped dependencies for criterion attempts; credentials stay here and never reach a prompt. */
export interface Verifier {
  context: WorkflowContext;
  run: RunManifest;
  signal: AbortSignal;
  workspace: string;
  out: string;
  browser: Browser;
  target: URL;
  config: VerificationConfig;
  redact: (text: string) => string;
}

/** Report progress on the verify stage and keep it as a step in the run's history. */
export function progress(v: Pick<Verifier, 'context' | 'run'>, message: string): void {
  v.context.emit({
    type: 'progress',
    runId: v.run.id,
    projectId: v.run.projectId,
    stage: 'verify',
    message,
  });
  void recordStep(v.context, v.run, message);
}

/** Submit one model turn; invalid output yields null so the caller records "Couldn't verify". */
export async function turn<T>(
  v: Verifier,
  workflow: string,
  schema: z.ZodType<T>,
  input: unknown,
  provider: ToolProvider,
): Promise<T | null> {
  v.signal.throwIfAborted();
  const instructions = await readFile(path.join(workflowRoot, 'workflows/v1', workflow), 'utf8');
  const output = outputSchemaFor(schema);
  const tools: LocalToolServer = await serveTools(provider);
  try {
    const result = await v.context.runtime.run({
      config: v.run.project.runtime,
      prompt: `${instructions}\n<input_data>\n${JSON.stringify(input)}\n</input_data>\nReturn ONLY the JSON object matching this schema:\n${JSON.stringify(output)}`,
      schema: output,
      cwd: v.workspace,
      tools,
      signal: v.signal,
      progress: (message) => progress(v, v.redact(message)),
    });
    v.run.runtimeVersion = result.version;
    const model = result.model ?? v.run.project.runtime.model;
    if (model !== undefined) v.run.runtimeModel = model;
    const parsed = schema.safeParse(result.value);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof ArtifactFormatError) return null;
    throw error;
  } finally {
    await tools.close();
  }
}

/** Ask a separate turn, which never sees the agent's reasoning, to judge the outlined screenshot. */
async function reviewScreenshot(
  v: Verifier,
  requirement: AppCheck,
  proof: PageCheck,
  file: string,
): Promise<VisionJudgment | null> {
  progress(v, `${requirement.key}: reviewing the proof screenshot`);
  return turn(
    v,
    'verify-vision.md',
    VisionJudgmentSchema,
    { criterion: requirement.text, outlinedElement: `${proof.role} "${proof.name}"` },
    new ProofViewer(file),
  );
}

/** Run one fresh, recorded browser session for a criterion and apply the evidence rules. */
export async function attempt(
  v: Verifier,
  requirement: AppCheck,
  index: number,
): Promise<VerificationAttempt> {
  const relative = path.posix.join(requirement.key, `attempt-${index}`);
  const dir = path.join(v.out, relative);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const api = requirement.method === 'api';
  const session = await openSession(v, requirement, dir);
  let outcome: CriterionOutcome | null;
  let video: string;
  try {
    outcome = await turn(
      v,
      api ? 'verify-api.md' : 'verify-criterion.md',
      CriterionOutcomeSchema,
      {
        criterion: requirement.text,
        requirement: requirement.edgeCaseId ? requirement.requirement : null,
        persona: requirement.persona,
        startUrl: api ? v.config.api!.url : v.target.href,
        ...(api ? { allowMutations: v.config.api!.allowMutations } : {}),
        credentialsAvailable: Boolean(v.config.credentials),
        ...(api ? { expiredTokenAvailable: Boolean(v.config.expiredToken) } : {}),
        stepLimit: v.config.stepLimit,
      },
      session,
    );
  } finally {
    video = await session.close();
  }
  const proof = reviewableProof(outcome, session.checks);
  const vision = await reviewEvidence(v, requirement, session, proof, dir);
  const judged = judgeEvidence(api, outcome, vision, session);
  /** Redact credentials and em dashes from model text before it is saved. */
  const clean = (value: string | null | undefined) =>
    value
      ? plainText(v.redact(session instanceof ApiSession ? session.http.redact(value) : value))
      : null;
  /** Make a media path relative to the verification folder so the report works from disk. */
  const media = (file: string) => path.posix.join(relative, file);
  return {
    attempt: index,
    verdict: judged.verdict,
    reason: judged.reason,
    explanation: clean(judged.explanation) ?? 'No explanation was recorded.',
    expected: clean(outcome?.expected),
    observed: clean(outcome?.observed),
    video: media(video),
    proof: judged.proof && { ...judged.proof, screenshot: media(judged.proof.screenshot) },
    vision: vision && { ...vision, observation: plainText(v.redact(vision.observation)) },
    steps: session.steps.map((step) => ({
      ...step,
      screenshot: step.screenshot && media(step.screenshot),
    })),
  };
}

/** Open the matching recorded tool session for the configured verification method. */
async function openSession(
  v: Verifier,
  requirement: AppCheck,
  dir: string,
): Promise<ApiSession | BrowserSession> {
  const api = requirement.method === 'api';
  return api
    ? await ApiSession.open(
        v.browser,
        new ApiHttp(
          v.config.api!.url,
          v.config.api!.allowMutations,
          v.signal,
          v.config.credentials,
          v.config.expiredToken,
        ),
        dir,
        requirement.text,
        v.config.stepLimit,
        (action) => progress(v, `${requirement.key}: ${action}`),
      )
    : await BrowserSession.open(v.browser, {
        start: v.target,
        allowedOrigins: v.config.allowedOrigins,
        credentials: v.config.credentials,
        stepLimit: v.config.stepLimit,
        dir,
        criterion: requirement.text,
        redact: v.redact,
        progress: (action) => progress(v, `${requirement.key}: ${action}`),
      });
}
/** Independently review the recorded assertion transcript or visible browser proof. */
async function reviewEvidence(
  v: Verifier,
  requirement: AppCheck,
  session: ApiSession | BrowserSession,
  proof: PageCheck | null,
  dir: string,
): Promise<VisionJudgment | null> {
  const api = requirement.method === 'api';
  return proof
    ? api
      ? await turn(
          v,
          'verify-api-review.md',
          VisionJudgmentSchema,
          {
            criterion: requirement.text,
            checks: session.checks,
            steps: session.steps,
          },
          noTools,
        )
      : await reviewScreenshot(v, requirement, proof, path.join(dir, proof.screenshot))
    : null;
}
/** Incomplete API coverage remains unverified even when the agent claims a verdict. */
function judgeEvidence(
  api: boolean,
  outcome: CriterionOutcome | null,
  vision: VisionJudgment | null,
  session: ApiSession | BrowserSession,
): ReturnType<typeof judgeAttempt> {
  return api && outcome?.outcome !== 'unverified' && vision?.judgment === 'unclear'
    ? {
        verdict: 'unverified' as const,
        reason: 'no_evidence' as const,
        explanation: vision.observation,
        proof: null,
      }
    : judgeAttempt({
        outcome,
        stepLimitReached: session.stepLimitReached,
        checks: session.checks,
        vision,
        api,
      });
}
