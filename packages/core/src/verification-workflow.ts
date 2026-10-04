import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type CriterionResult,
  type RunManifest,
  type TriageItem,
  TriageSchema,
  type VerificationResult,
} from '../../contracts/src/index.js';
import { noTools } from '../../tools/src/mcp.js';
import { betaTarget, deployedRevision } from '../../verification/src/index.js';
import {
  criterionResult,
  launchBrowser,
  loadVerificationConfig,
  reasonLabels,
  redactor,
  renderReport,
  shouldRetry,
  summarize,
  verificationTarget,
} from '../../verification/src/index.js';
import { appendActivity } from './activity.js';
import { blockedRequirements } from './blockers.js';
import { atomic, optionalJson } from './storage.js';
import {
  type AppCheck,
  appChecks,
  type CheckItem,
  checkItems,
  itemKey,
  planSummary,
  reconcilePlan,
} from './triage.js';
import { attempt, progress, turn, type Verifier } from './verification-attempt.js';
import type { WorkflowContext } from './workflow-context.js';

/** Explain the missing method-specific target without treating another service as the app. */
function missingTarget(v: Verifier, check: AppCheck): string | null {
  if (check.method === 'api' && !v.config.api)
    return 'Set an API URL in project settings, or verify this requirement manually.';
  if (check.method !== 'api' && v.config.api && !v.config.url)
    return 'Set the browser app URL in project settings, or verify this requirement manually.';
  return null;
}
/** Persist an inconclusive check and give the user a manual verification action. */
async function saveUnavailable(
  v: Verifier,
  check: AppCheck,
  explanation: string,
): Promise<CriterionResult> {
  const result: CriterionResult = {
    requirementId: check.requirementId,
    edgeCaseId: check.edgeCaseId,
    method: check.method ?? 'app',
    criterion: check.text,
    verdict: 'unverified',
    reason: 'blocked',
    explanation,
    expected: null,
    observed: null,
    decisiveAttempt: null,
    attempts: [],
  };
  await atomic(path.join(v.out, check.key, 'result.json'), result, v.signal);
  await logResult(v, check, result);
  return result;
}

/** Verify one requirement or edge case with a single retry, reusing a saved result on resume. */
async function verifyCriterion(v: Verifier, check: AppCheck): Promise<CriterionResult> {
  const file = path.join(v.out, check.key, 'result.json');
  const saved = await optionalJson<CriterionResult>(file);
  if (
    saved &&
    saved.requirementId === check.requirementId &&
    (saved.edgeCaseId ?? null) === check.edgeCaseId
  )
    return saved;
  // An interrupted criterion restarts cleanly so its evidence always comes from complete sessions.
  await rm(path.join(v.out, check.key), { recursive: true, force: true });
  progress(v, `${check.key}: ${check.text}`);
  const missing = missingTarget(v, check);
  if (missing) return saveUnavailable(v, check, missing);
  const attempts = [await attempt(v, check, 1)];
  if (check.method !== 'api' && shouldRetry(attempts[0]!)) {
    progress(v, `${check.key}: checking again in a fresh browser`);
    attempts.push(await attempt(v, check, 2));
  }
  const result: CriterionResult = {
    ...criterionResult(check.requirementId, v.redact(check.text), attempts),
    edgeCaseId: check.edgeCaseId,
    persona: check.persona,
    method: check.method ?? 'app',
  };
  await atomic(file, result, v.signal);
  const label =
    result.verdict === 'unverified' ? reasonLabels[result.reason ?? 'other'] : result.verdict;
  progress(v, `${check.key}: ${label}`);
  await logResult(v, check, result);
  return result;
}

/** Record what a browser check concluded, pointing at its recording as evidence. */
async function logResult(v: Verifier, check: AppCheck, result: CriterionResult): Promise<void> {
  const name = check.edgeCaseId
    ? `${check.requirementId} edge case ${check.edgeCaseId}`
    : check.requirementId;
  const location = check.method === 'api' ? 'via the API' : 'in the app';
  const as = check.persona ? ` as ${check.persona}` : '';
  const summary =
    result.verdict === 'pass'
      ? `${name} works ${location}${as}.`
      : result.verdict === 'fail'
        ? `${name} is broken ${location}${as}.${result.observed ? ` ${result.observed}` : ''}`
        : `${name}: couldn't check ${location}. ${result.explanation}`;
  await appendActivity(
    v.context,
    v.run,
    {
      kind: result.verdict === 'pass' ? 'check' : result.verdict === 'fail' ? 'find' : 'result',
      requirementId: check.requirementId,
      ...(check.edgeCaseId ? { edgeCaseId: check.edgeCaseId } : {}),
      summary,
      reason: result.explanation,
      evidence: check.key,
    },
    v.redact,
  );
}

/** Decide how to check each requirement and edge case, reusing a saved plan when a run resumes. */
async function planChecks(v: Verifier, dir: string, items: CheckItem[]): Promise<TriageItem[]> {
  if (!items.length) return [];
  const file = path.join(dir, 'triage.json');
  const saved = TriageSchema.safeParse(await optionalJson(file));
  if (saved.success) return reconcilePlan(items, saved.data.items);
  progress(v, 'Deciding how to check each requirement');
  const proposed = await turn(
    v,
    'triage.md',
    TriageSchema,
    {
      items: items.map(({ requirementId, edgeCaseId, text, requirement }) => ({
        requirementId,
        edgeCaseId,
        text,
        requirement: edgeCaseId ? requirement : null,
      })),
      appUrl: v.config.url ?? (v.config.api ? null : v.target.href),
      apiUrl: v.config.api?.url ?? null,
      credentialsAvailable: Boolean(v.config.credentials),
    },
    noTools,
  );
  const plan = reconcilePlan(items, proposed?.items ?? null);
  await atomic(file, { items: plan }, v.signal);
  await appendActivity(v.context, v.run, {
    kind: 'decide',
    summary: planSummary(plan),
    reason:
      'Aiden checks visible behavior in the app, HTTP behavior through the API, and asks a person when a check needs other evidence.',
  });
  for (const p of plan.filter((item) => item.method === 'person'))
    await appendActivity(v.context, v.run, {
      kind: 'decide',
      requirementId: p.requirementId,
      ...(p.edgeCaseId ? { edgeCaseId: p.edgeCaseId } : {}),
      summary: `${itemKey(p.requirementId, p.edgeCaseId)} needs a person to confirm.`,
      reason: p.reason,
    });
  return plan;
}

/** A stopped browser app must not prevent configured API checks from finishing. */
async function verifyConfigured(v: Verifier, check: AppCheck): Promise<CriterionResult> {
  try {
    return await verifyCriterion(v, check);
  } catch (error) {
    v.signal.throwIfAborted();
    if (
      v.config.api &&
      check.method !== 'api' &&
      error instanceof Error &&
      error.message.startsWith('Could not open ')
    )
      return saveUnavailable(
        v,
        check,
        'The browser app could not be opened. Start it and check again, or verify this requirement manually.',
      );
    throw error;
  }
}

/** Build the result for what has been checked so far; used for both progress and the final save. */
function buildResult(
  run: RunManifest,
  target: URL,
  triage: TriageItem[],
  criteria: CriterionResult[],
): VerificationResult {
  return {
    ...(run.beta ? { environment: 'beta' as const, deploymentRevision: run.beta.revision } : {}),
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
    triage,
  };
}

/**
 * Save what Aiden has checked so far and tell the renderer, so Watch can show a completed
 * criterion's recording while later criteria in the same run are still being checked.
 */
async function publishProgress(
  v: Verifier,
  out: string,
  target: URL,
  triage: TriageItem[],
  criteria: CriterionResult[],
): Promise<void> {
  const result = { ...buildResult(v.run, target, triage, criteria), partial: true };
  await atomic(path.join(out, 'results.json'), result, v.signal);
  await writeFile(path.join(out, 'report.html'), renderReport(result), { mode: 0o600 });
  v.context.emit({
    type: 'progress',
    runId: v.run.id,
    projectId: v.run.projectId,
    stage: 'verify',
    verification: result.summary,
  });
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
  if (run.beta) {
    if (betaTarget(config, run.beta.revisionUrl).href !== target.href)
      throw new Error('The configured beta target changed before verification.');
    if ((await deployedRevision(run.beta.revisionUrl)) !== run.beta.revision)
      throw new Error('Beta changed before verification. Wait for the next scheduled check.');
  }
  const redact = verificationRedactor(config);
  const out = path.join(dir, 'verification');
  await mkdir(out, { recursive: true, mode: 0o700 });
  run.stage = 'verify';
  run.status = 'running';
  await atomic(path.join(dir, 'manifest.json'), run, signal);
  const browser = await launchBrowser();
  const criteria: CriterionResult[] = [];
  let triage: TriageItem[];
  try {
    const v: Verifier = { context, run, signal, workspace, out, browser, target, config, redact };
    const items = await eligibleChecks(context, run);
    triage = await planChecks(v, dir, items);
    const { checks, deferred } = appChecks(items, triage);
    if (deferred)
      await appendActivity(context, run, {
        kind: 'decide',
        summary: `Left ${deferred} edge cases for a later look to keep this one to ${checks.length} checks.`,
      });
    for (const check of checks) {
      if (await checkBlocked(context, run, check.requirementId)) continue;
      criteria.push(await verifyConfigured(v, check));
      if (!run.beta) await publishProgress(v, out, target, triage, criteria);
    }
  } finally {
    await browser.close();
  }
  if (run.beta && (await deployedRevision(run.beta.revisionUrl)) !== run.beta.revision)
    throw new Error('Beta changed during verification. No completion evidence was published.');
  const result = buildResult(run, target, triage, criteria);
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

/** Recheck eligibility immediately before browser or API actions. */
async function checkBlocked(
  context: WorkflowContext,
  run: RunManifest,
  requirementId: string,
): Promise<boolean> {
  const blocked = await blockedRequirements(context.store, run.projectId, run.baseline!.product);
  return Boolean(blocked.get(requirementId)?.length);
}

/** Exclude blocked scope before asking a model to plan browser or API checks. */
async function eligibleChecks(context: WorkflowContext, run: RunManifest): Promise<CheckItem[]> {
  const blocked = await blockedRequirements(context.store, run.projectId, run.baseline!.product);
  return checkItems(run.baseline!.product).filter(
    (item) => !blocked.get(item.requirementId)?.length,
  );
}

/** Redact configured secrets consistently from browser/API evidence and recordings. */
function verificationRedactor(config: Verifier['config']): Verifier['redact'] {
  return redactor([
    config.credentials?.username ?? '',
    config.credentials?.password ?? '',
    config.expiredToken ?? '',
  ]);
}
