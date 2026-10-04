import path from 'node:path';

import {
  type BetaSettings,
  BetaSettingsSchema,
  type CodingJob,
} from '../../contracts/src/index.js';
import { findJobPullRequest, github, readPullRequest } from '../../tools/src/delivery-git.js';
import { betaTarget, deployedRevision } from '../../verification/src/index.js';
import { codingActive, codingJobs, saveJob } from './coding-jobs.js';
import type { Engine } from './engine.js';
import { readLifecycle } from './project-lifecycle.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { atomic, optionalJson, uid } from './storage.js';
import { readAppUrl } from './verification-settings.js';
import { readVerification } from './verification-workflow.js';

/** External status reads are injectable; reconciliation itself is shared with production. */
export const deliveryServices = { readPullRequest, findJobPullRequest, deployedRevision, github };
/** Read public post-merge settings without loading credentials. */
export async function betaSettings(engine: Engine, projectId: string): Promise<BetaSettings> {
  return BetaSettingsSchema.parse(
    (await optionalJson(path.join(engine.store.project(projectId), 'beta.json'))) ?? {},
  );
}
/** Save a schedule only with a configured beta and an origin-matched revision endpoint. */
export async function saveBetaSettings(
  engine: Engine,
  projectId: string,
  input: unknown,
): Promise<BetaSettings> {
  const settings = BetaSettingsSchema.parse(input);
  const { project } = await engine.state(projectId);
  if (!project) throw new Error('Save the project first.');
  if (settings.enabled) {
    const target = await readAppUrl(engine, projectId);
    betaTarget(target, settings.revisionUrl ?? '');
  }
  await atomic(path.join(engine.store.project(projectId), 'beta.json'), settings);
  return settings;
}
/** One reconciliation at a time per project, including explicit UI refreshes and timer ticks. */
const checking = new WeakMap<Engine, Map<string, Promise<CodingJob[]>>>();
/** Recover missing completion events and advance only when independently observed prerequisites hold. */
export function reconcileDelivery(
  engine: Engine,
  projectId: string,
  now = new Date(),
): Promise<CodingJob[]> {
  const map = checking.get(engine) ?? new Map<string, Promise<CodingJob[]>>();
  checking.set(engine, map);
  const previous = map.get(projectId);
  if (previous) return previous;
  const task = lockedReconcile(engine, projectId, now).finally(() => map.delete(projectId));
  map.set(projectId, task);
  return task;
}
/** Serialize delivery reconciliation with project decisions, including detached coding callbacks. */
async function lockedReconcile(engine: Engine, projectId: string, now: Date): Promise<CodingJob[]> {
  const release = await acquireProjectLock(engine.store, projectId, 'delivery');
  try {
    return await reconcile(engine, projectId, now);
  } finally {
    await release();
  }
}
/** Reconcile each durable job independently so one unavailable PR cannot hide other jobs. */
async function reconcile(engine: Engine, projectId: string, now: Date): Promise<CodingJob[]> {
  const jobs = await codingJobs(engine, projectId);
  if ((await readLifecycle(engine.store, projectId)).status === 'closed') return jobs;
  const settings = await betaSettings(engine, projectId);
  const { baseline } = await engine.state(projectId);
  for (const job of jobs) {
    try {
      if (job.status === 'running') {
        if (codingActive(engine, job.id)) continue;
        job.status = 'interrupted';
        job.message =
          'Aiden lost the external session. Inspect the preserved worktree and Claude session before retrying.';
      } else if (job.baselineId !== baseline?.id) {
        job.status = 'stale';
        job.message = 'Requirements changed. This job cannot verify the new scope.';
      } else if (job.status === 'failed' && job.model) {
        const url = await deliveryServices.findJobPullRequest(
          job.repository,
          job.branch,
          job.baseBranch,
        );
        if (url) {
          job.pullRequestUrl = url;
          job.status = 'awaiting_merge';
          await advanceMerged(engine, job, settings, now);
        }
      } else if (job.status === 'verifying') await collectBeta(engine, job, now, settings);
      else if (
        job.pullRequestUrl &&
        !['failed', 'needs_input', 'interrupted', 'stale'].includes(job.status)
      )
        await advanceMerged(engine, job, settings, now);
      delete job.error;
    } catch (error) {
      job.error = error instanceof Error ? error.message : 'Delivery status could not be checked.';
    }
    await saveJob(engine, job);
  }
  return jobs;
}
/** Read merge/review/CI state from GitHub; only a merged PR can reach beta verification. */
async function advanceMerged(
  engine: Engine,
  job: CodingJob,
  settings: BetaSettings,
  now: Date,
): Promise<void> {
  const pr = await deliveryServices.readPullRequest(
    job.repository,
    job.pullRequestUrl!,
    job.branch,
    job.baseBranch,
  );
  if (pr.state === 'CLOSED') {
    job.status = 'needs_input';
    job.message = 'The PR closed without merging.';
    return;
  }
  if (pr.state !== 'MERGED' || !pr.mergeCommit) {
    job.status = 'awaiting_merge';
    job.message = `Waiting for merge. Review: ${pr.reviewDecision || 'not recorded'}. GitHub reports ${pr.statusCheckRollup?.length ?? 0} CI checks. Local checks are reported by Claude Code.`;
    return;
  }
  job.mergeSha = pr.mergeCommit.oid;
  if (job.nextCheckAt && new Date(job.nextCheckAt) > now) return;
  job.status = 'awaiting_deployment';
  job.message = 'Merged. Waiting for the configured beta deployment and verification schedule.';
  if (!settings.enabled || !settings.revisionUrl || engine.isBusy(job.projectId)) return;
  await startBeta(engine, job, settings.revisionUrl);
}

/** Start only after the deployed revision includes the independently observed merge commit. */
async function startBeta(engine: Engine, job: CodingJob, revisionUrl: string): Promise<void> {
  const target = await readAppUrl(engine, job.projectId);
  const url = betaTarget(target, revisionUrl);
  const revision = await deliveryServices.deployedRevision(revisionUrl);
  if (revision !== job.mergeSha) {
    const comparison = (await deliveryServices.github([
      'api',
      `repos/${job.repository}/compare/${job.mergeSha}...${revision}`,
    ])) as { status?: string };
    if (comparison.status !== 'ahead' && comparison.status !== 'identical') return;
  }
  const runId = uid();
  job.verificationRunId = runId;
  job.deploymentRevision = revision;
  job.status = 'verifying';
  job.message = 'Checking the merged change on beta. Aiden is not running local tests.';
  await saveJob(engine, job);
  await engine.verify(job.projectId, url.href, undefined, {
    runId,
    beta: { jobId: job.id, revision, revisionUrl: revisionUrl },
  });
}
/** Collect only this job's exact beta run, never a previous successful check. */
async function collectBeta(
  engine: Engine,
  job: CodingJob,
  now: Date,
  settings: BetaSettings,
): Promise<void> {
  if (engine.isActive(job.verificationRunId!)) return;
  const check = await readVerification(engine, job.projectId, job.verificationRunId);
  if (
    !check ||
    check.result.partial ||
    check.result.runId !== job.verificationRunId ||
    check.result.projectId !== job.projectId ||
    check.result.baselineId !== job.baselineId ||
    check.result.environment !== 'beta' ||
    check.result.deploymentRevision !== job.deploymentRevision
  ) {
    job.status = 'unverified';
    job.message = 'Beta verification stopped before producing complete evidence.';
  } else {
    const summary = check.result.summary;
    job.status = summary.failed
      ? 'failing'
      : summary.unverified || !summary.total
        ? 'unverified'
        : 'verified';
    job.message = `Beta verification: ${summary.line}`;
  }
  job.nextCheckAt = new Date(now.getTime() + settings.intervalMinutes * 60000).toISOString();
}
