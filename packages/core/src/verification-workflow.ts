import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from 'playwright';
import type { z } from 'zod/v3';

import {
  type CriterionOutcome,
  CriterionOutcomeSchema,
  type CriterionResult,
  outputSchemaFor,
  type PageCheck,
  type RunManifest,
  type VerificationAttempt,
  type VerificationConfig,
  VerificationConfigSchema,
  type VerificationResult,
  type VerificationSettings,
  type VisionJudgment,
  VisionJudgmentSchema,
} from '../../contracts/src/index.js';
import { ArtifactFormatError } from '../../runtimes/src/index.js';
import { type LocalToolServer, serveTools, type ToolProvider } from '../../tools/src/mcp.js';
import {
  BrowserSession,
  criterionResult,
  judgeAttempt,
  launchBrowser,
  loadVerificationConfig,
  parseAppUrl,
  plainText,
  ProofViewer,
  reasonLabels,
  redactor,
  renderReport,
  reviewableProof,
  settingsFile,
  shouldRetry,
  summarize,
  verificationTarget,
} from '../../verification/src/index.js';
import { workflowRoot } from './model-stage.js';
import { atomic, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

type Requirement = { id: string; text: string };

/** Run-scoped dependencies for criterion attempts; credentials stay here and never reach a prompt. */
interface Verifier {
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

/** Report progress on the verify stage. */
function progress(v: Pick<Verifier, 'context' | 'run'>, message: string): void {
  v.context.emit({
    type: 'progress',
    runId: v.run.id,
    projectId: v.run.projectId,
    stage: 'verify',
    message,
  });
}

/** Submit one model turn; invalid output yields null so the caller records "Couldn't verify". */
async function turn<T>(
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
  requirement: Requirement,
  proof: PageCheck,
  file: string,
): Promise<VisionJudgment | null> {
  progress(v, `${requirement.id}: reviewing the proof screenshot`);
  return turn(
    v,
    'verify-vision.md',
    VisionJudgmentSchema,
    { criterion: requirement.text, outlinedElement: `${proof.role} "${proof.name}"` },
    new ProofViewer(file),
  );
}

/** Run one fresh, recorded browser session for a criterion and apply the evidence rules. */
async function attempt(
  v: Verifier,
  requirement: Requirement,
  index: number,
): Promise<VerificationAttempt> {
  const relative = path.posix.join(requirement.id, `attempt-${index}`);
  const dir = path.join(v.out, relative);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const session = await BrowserSession.open(v.browser, {
    start: v.target,
    allowedOrigins: v.config.allowedOrigins,
    credentials: v.config.credentials,
    stepLimit: v.config.stepLimit,
    dir,
    criterion: requirement.text,
    redact: v.redact,
    progress: (action) => progress(v, `${requirement.id}: ${action}`),
  });
  let outcome: CriterionOutcome | null;
  let video: string;
  try {
    outcome = await turn(
      v,
      'verify-criterion.md',
      CriterionOutcomeSchema,
      {
        criterion: requirement.text,
        startUrl: v.target.href,
        credentialsAvailable: Boolean(v.config.credentials),
        stepLimit: v.config.stepLimit,
      },
      session,
    );
  } finally {
    video = await session.close();
  }
  const proof = reviewableProof(outcome, session.checks);
  const vision = proof
    ? await reviewScreenshot(v, requirement, proof, path.join(dir, proof.screenshot))
    : null;
  const judged = judgeAttempt({
    outcome,
    stepLimitReached: session.stepLimitReached,
    checks: session.checks,
    vision,
  });
  /** Redact credentials and em dashes from model text before it is saved. */
  const clean = (value: string | null | undefined) => (value ? plainText(v.redact(value)) : null);
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

/** Verify one criterion with a single retry, reusing a saved result when a run resumes. */
async function verifyCriterion(v: Verifier, requirement: Requirement): Promise<CriterionResult> {
  const file = path.join(v.out, requirement.id, 'result.json');
  const saved = await optionalJson<CriterionResult>(file);
  if (saved && saved.requirementId === requirement.id) return saved;
  // An interrupted criterion restarts cleanly so its evidence always comes from complete sessions.
  await rm(path.join(v.out, requirement.id), { recursive: true, force: true });
  progress(v, `${requirement.id}: ${requirement.text}`);
  const attempts = [await attempt(v, requirement, 1)];
  if (shouldRetry(attempts[0]!)) {
    progress(v, `${requirement.id}: checking again in a fresh browser`);
    attempts.push(await attempt(v, requirement, 2));
  }
  const result = criterionResult(requirement.id, v.redact(requirement.text), attempts);
  await atomic(file, result, v.signal);
  const label =
    result.verdict === 'unverified' ? reasonLabels[result.reason ?? 'other'] : result.verdict;
  progress(v, `${requirement.id}: ${label}`);
  return result;
}

/** Test every approved requirement against the configured URL and publish the evidence report. */
export async function executeVerification(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  workspace: string,
): Promise<void> {
  const projectDir = context.store.project(run.projectId);
  const config = await loadVerificationConfig(projectDir, process.env);
  const target = verificationTarget(run.verifyUrl ?? '', config.allowedOrigins);
  const redact = redactor([config.credentials?.username ?? '', config.credentials?.password ?? '']);
  const out = path.join(dir, 'verification');
  await mkdir(out, { recursive: true, mode: 0o700 });
  run.stage = 'verify';
  run.status = 'running';
  await atomic(path.join(dir, 'manifest.json'), run, signal);
  const browser = await launchBrowser();
  const criteria: CriterionResult[] = [];
  try {
    const v: Verifier = { context, run, signal, workspace, out, browser, target, config, redact };
    for (const requirement of run.baseline!.product.requirements)
      criteria.push(await verifyCriterion(v, requirement));
  } finally {
    await browser.close();
  }
  const result: VerificationResult = {
    schemaVersion: '1.0',
    runId: run.id,
    projectId: run.projectId,
    projectName: run.project.name,
    baselineId: run.baseline!.id,
    url: target.href,
    generatedAt: new Date().toISOString(),
    runtime: {
      provider: run.project.runtime.provider,
      auth: run.project.runtime.auth,
      model: run.runtimeModel ?? null,
      version: run.runtimeVersion ?? 'unknown',
    },
    criteria,
    summary: summarize(criteria),
  };
  await atomic(path.join(out, 'results.json'), result, signal);
  await writeFile(path.join(out, 'report.html'), renderReport(result), { mode: 0o600 });
  await atomic(path.join(projectDir, 'latest-verification.json'), { id: run.id }, signal);
  run.stage = 'complete';
  run.status = 'completed';
  await atomic(path.join(dir, 'manifest.json'), run, signal);
  context.emit({
    type: 'completed',
    runId: run.id,
    projectId: run.projectId,
    stage: 'complete',
    verification: result.summary,
  });
}

/** Read a saved verification result and its report path; the latest run is used when none is named. */
export async function readVerification(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
  runId?: string,
): Promise<{ result: VerificationResult; reportPath: string } | null> {
  const id =
    runId ??
    (
      await optionalJson<{ id: string }>(
        path.join(context.store.project(projectId), 'latest-verification.json'),
      )
    )?.id;
  if (!id) return null;
  const out = path.join(context.store.run(projectId, id), 'verification');
  const result = await optionalJson<VerificationResult>(path.join(out, 'results.json'));
  return result && { result, reportPath: path.join(out, 'report.html') };
}

/** Choose the given URL or the project's saved one, then apply the local-or-configured origin rule. */
export async function resolveVerifyUrl(projectDir: string, url?: string): Promise<string> {
  const config = await loadVerificationConfig(projectDir, process.env);
  const target = url ?? config.url;
  if (!target)
    throw new Error(
      "Save this project's app URL (App URL on its overview, or the verify-url command), or pass --url.",
    );
  return verificationTarget(target, config.allowedOrigins).href;
}

/** Read the settings file as saved, without environment credentials or derived origins. */
async function savedSettings(projectDir: string): Promise<VerificationConfig> {
  const file = settingsFile(projectDir);
  let raw: unknown;
  try {
    raw = await optionalJson(file);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${file} is not valid JSON.`, { cause: error });
    throw error;
  }
  return VerificationConfigSchema.parse(raw ?? {});
}

/** Read the project's saved app URL for display; test credentials never leave the worker. */
export async function readAppUrl(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
): Promise<VerificationSettings> {
  return { url: (await savedSettings(context.store.project(projectId))).url ?? null };
}

/** Save or clear the project's app URL, keeping every other setting in the owner-only file. */
export async function saveAppUrl(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
  url: string | null,
): Promise<VerificationSettings> {
  const projectDir = context.store.project(projectId);
  if (!(await optionalJson(path.join(projectDir, 'project.json'))))
    throw new Error('Save this project before setting its app URL.');
  const settings = await savedSettings(projectDir);
  delete settings.url;
  if (url !== null) settings.url = parseAppUrl(url.trim()).href;
  await atomic(settingsFile(projectDir), settings);
  return { url: settings.url ?? null };
}
