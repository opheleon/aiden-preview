import path from 'node:path';

import {
  type Baseline,
  type Call,
  type LookReason,
  type Product,
  type Project,
  ProjectSchema,
  type RunManifest,
} from '../../contracts/src/index.js';
import { publicError } from '../../runtimes/src/index.js';
import { monitoredHead } from '../../tools/src/remote-branches.js';
import { parseAppUrl } from '../../verification/src/index.js';
import { blockedRequirements } from './blockers.js';
import { answerCall, answeredDecisions, readCalls, settleAppUrlCalls } from './calls.js';
import type { Engine } from './engine.js';
import { initializeMonitoring } from './monitoring.js';
import { atomic, hash, json, optionalJson } from './storage.js';
import { syncTickets } from './ticket-sync.js';
import { findRunningApp, saveAppUrl } from './verification-settings.js';

/** What a person can change about the intent: the sentence or brief itself, or what done means. */
export type IntentChange = { context: string } | { product: Product };

/** One repository's current commit; null when Git could not read it. */
type Head = { repositoryId: string; sha: string | null };

/**
 * The current commit of each project repository. `changed` means a readable commit differs from
 * the one Aiden last looked at, `ready` means what done means exists, `active` means Aiden is
 * already working on the project, and `lastLookAt` is when the last look started.
 */
export type Heads = {
  repositories: Head[];
  active: boolean;
  changed: boolean;
  ready: boolean;
  lastLookAt: string | null;
};

/** The commits a look started from, and when. */
type Looked = { at: string; repositories: Head[] };

/** Where Aiden keeps the commits it last looked at. */
const lookedFile = (engine: Engine, projectId: string): string =>
  path.join(engine.store.project(projectId), 'looked-heads.json');

/** Projects with a scope answer that arrived while Aiden was busy, per worker engine. */
const waitingAnswers = new WeakMap<Engine, Set<string>>();

/** Whether a scope answer is waiting on the project, clearing it so it is used once. */
function takeWaitingAnswer(engine: Engine, projectId: string): boolean {
  return waitingAnswers.get(engine)?.delete(projectId) ?? false;
}

/**
 * The current chain of work on a project has ended. A scope answer that arrived meanwhile is
 * used now: Aiden rewrites what done means with it and looks again, so the answer never waits
 * for the next commit.
 */
function chainEnded(engine: Engine, projectId: string, runId: string): void {
  // With the code check and browser check running together, the last one to finish acts.
  if (engine.isBusy(projectId) || !takeWaitingAnswer(engine, projectId)) return;
  void savedProject(engine, projectId)
    .then((project) => prepareAndLook(engine, project, 'answer'))
    .catch((e: unknown) =>
      engine.emit({
        type: 'failed',
        runId,
        projectId,
        message: `Aiden could not use your answer yet. ${publicError(e)}`,
      }),
    );
}

/**
 * Wait for a run, then continue with `next` when it finished successfully. `next` returns true
 * when it started more work that ends the chain itself. Otherwise, or when the run failed or was
 * cancelled (the app was already told why), the chain ends here. A failure to continue is
 * reported against the finished run.
 */
function afterRun(
  engine: Engine,
  projectId: string,
  runId: string,
  next: (run: RunManifest) => Promise<boolean>,
  failure: string,
): void {
  void (async () => {
    // The run releases its project lock before wait() settles, so the next run can take it.
    await engine.wait(runId);
    const run = (await engine.state(projectId)).runs.find((r) => r.id === runId);
    const continued = run?.status === 'completed' && (await next(run));
    if (!continued) chainEnded(engine, projectId, runId);
  })().catch((e: unknown) => {
    engine.emit({ type: 'failed', runId, projectId, message: `${failure} ${publicError(e)}` });
    chainEnded(engine, projectId, runId);
  });
}

/** The chain ends when this run does, whatever its outcome. */
const endsChain = (): Promise<boolean> => Promise.resolve(false);

/**
 * After an accepted code assessment, find the running app and check it in a browser. When Aiden
 * cannot tell where the app runs, it records a call and the look ends with the code assessment.
 */
export function followWithBrowserCheck(
  engine: Engine,
  projectId: string,
  reportRunId: string,
  reason?: LookReason,
): void {
  afterRun(
    engine,
    projectId,
    reportRunId,
    async (run) => {
      if (!(await findRunningApp(engine, run, engine.discover))) return false;
      const check = await engine.verify(projectId, undefined, reason);
      afterRun(engine, projectId, check.runId, endsChain, 'The browser check did not finish.');
      return true;
    },
    'The code assessment finished, but the browser check could not start.',
  );
}

/**
 * The latest look that stopped before finishing against the current "what done means", if any.
 * Picking it up keeps its checkpoints, so finished paid stages are not repeated.
 */
async function interruptedLook(engine: Engine, projectId: string): Promise<string | null> {
  const { baseline, runs } = await engine.state(projectId);
  const latest = runs.find((r) => r.kind === 'report');
  if (!latest || !baseline || engine.isActive(latest.id)) return null;
  const unfinished = latest.status !== 'completed' && latest.status !== 'review';
  const project = await savedProject(engine, projectId);
  const sameBranches = latest.project.repositories.every(
    (repo) =>
      JSON.stringify(repo.monitoredBranch) ===
      JSON.stringify(project.repositories.find((r) => r.id === repo.id)?.monitoredBranch),
  );
  return unfinished && sameBranches && latest.baseline?.id === baseline.id ? latest.id : null;
}

/**
 * Look at a project: assess the code against what done means, then check the running app. When
 * a person asks and the last look stopped early, Aiden picks that look up instead of starting
 * over; a look started by new commits always starts fresh because the code changed.
 */
export async function startLook(
  engine: Engine,
  projectId: string,
  reason: LookReason,
): Promise<{ runId: string }> {
  const { baseline } = await engine.state(projectId);
  const decisions = await answeredDecisions(engine.store, projectId);
  const changed =
    baseline?.decisionsHash !== undefined
      ? baseline.decisionsHash !== hash(decisions)
      : (await readCalls(engine.store, projectId)).some(
          (call) =>
            call.kind === 'decision' &&
            call.status === 'answered' &&
            !!call.answeredAt &&
            !!baseline &&
            call.answeredAt > baseline.reviewedAt,
        );
  // Recover corrections persisted before a worker restart, including legacy projects. Rewrite
  // before resuming an old report or starting browser checks against the superseded scope.
  if (changed) return prepareAndLook(engine, await savedProject(engine, projectId), 'answer');
  const resumable = reason === 'you' ? await interruptedLook(engine, projectId) : null;
  const started = resumable
    ? await engine.resume(projectId, resumable)
    : await engine.report(projectId, reason);
  afterRun(
    engine,
    projectId,
    started.runId,
    async (run) => {
      await syncTickets(engine, projectId);
      if (!run.baseline?.product.deliveryPlan) return false;
      const blockers = await blockedRequirements(engine.store, projectId, run.baseline.product);
      if ([...blockers.values()].some((calls) => calls.length)) return false;
      const estimate = await engine.estimate(projectId, run.id);
      afterRun(
        engine,
        projectId,
        estimate.runId,
        endsChain,
        'Remaining-work sizing did not finish.',
      );
      return true;
    },
    'The code check finished, but remaining-work sizing could not start.',
  );
  await settleAppUrlCalls(
    engine.store,
    projectId,
    'Local checks belong to the coding agent. Configure scheduled beta verification in Settings.',
  );
  const project = await savedProject(engine, projectId);
  const looked: Looked = {
    at: new Date().toISOString(),
    repositories: await readHeads(engine, project),
  };
  await atomic(lookedFile(engine, projectId), looked);
  return started;
}

/** Rewrite what done means from the intent without stopping for review, then look. */
export async function prepareAndLook(
  engine: Engine,
  project: Project,
  reason: LookReason,
): Promise<{ runId: string }> {
  const started = await engine.prepare(project, { autoAccept: true, reason });
  afterRun(
    engine,
    project.id,
    started.runId,
    async () => {
      await syncTickets(engine, project.id);
      // An answer that arrived during the rewrite changes scope again, so rewrite before looking.
      if (takeWaitingAnswer(engine, project.id))
        await prepareAndLook(engine, await savedProject(engine, project.id), 'answer');
      else await startLook(engine, project.id, reason);
      return true;
    },
    'Aiden updated the requirements, but could not start a check.',
  );
  return started;
}

/** Read the saved project definition. */
async function savedProject(engine: Engine, projectId: string): Promise<Project> {
  return ProjectSchema.parse(
    await json(path.join(engine.store.project(projectId), 'project.json')),
  );
}

/**
 * Record a person's answer and act on it. An app address is saved and checked straight away; a
 * scope decision makes Aiden rewrite what done means and look again. While Aiden is already
 * working on the project, `runId` is null: a scope decision is used as soon as the current work
 * ends, and an app address is used by the look in progress or the next one.
 */
export async function answerAndLook(
  engine: Engine,
  projectId: string,
  callId: string,
  answer: string,
): Promise<{ call: Call; runId: string | null }> {
  const open = (await readCalls(engine.store, projectId)).find((c) => c.id === callId);
  if (!open || open.status !== 'open') throw new Error('This call is no longer open.');
  const url = open.kind === 'app-url' ? parseAppUrl(answer.trim()).href : null;
  if (url) await saveAppUrl(engine, projectId, url);
  const call = await answerCall(engine.store, projectId, callId, url ?? answer);
  if (engine.isBusy(projectId)) {
    if (!url) waitingAnswers.set(engine, (waitingAnswers.get(engine) ?? new Set()).add(projectId));
    return { call, runId: null };
  }
  if (!url) {
    const started = await prepareAndLook(engine, await savedProject(engine, projectId), 'answer');
    return { call, runId: started.runId };
  }
  return { call, runId: null };
}

/**
 * Apply a change to the intent. An edited "what done means" becomes the new baseline and Aiden
 * looks against it; a changed sentence or brief makes Aiden rewrite what done means first.
 */
export async function editIntent(
  engine: Engine,
  projectId: string,
  change: IntentChange,
): Promise<{ runId: string }> {
  if ('product' in change) {
    await engine.editProduct(projectId, change.product);
    return startLook(engine, projectId, 'intent');
  }
  const project = await savedProject(engine, projectId);
  return prepareAndLook(engine, { ...project, context: change.context }, 'intent');
}

/** Read selected remote commits without changing local refs or the checkout. */
async function readHeads(engine: Engine, project: Project): Promise<Head[]> {
  // Only repositories what done means is about count; commits elsewhere do not start a look.
  const baseline = await optionalJson<Baseline>(
    path.join(engine.store.project(project.id), 'baseline.json'),
  );
  const scope = baseline?.product.repositories;
  const watched = scope?.length
    ? project.repositories.filter((r) => scope.includes(r.id))
    : project.repositories;
  return Promise.all(
    watched.map(async (r) => {
      try {
        return { repositoryId: r.id, sha: (await monitoredHead(r)).sha };
      } catch {
        return { repositoryId: r.id, sha: null };
      }
    }),
  );
}

/**
 * Report whether code changed since Aiden last looked. An unreadable repository reports null and
 * never counts as a change, so one moved folder does not start looks; a project Aiden has not
 * looked at yet has nothing to compare against.
 */
export async function repositoryHeads(engine: Engine, projectId: string): Promise<Heads> {
  const project = engine.isBusy(projectId)
    ? await savedProject(engine, projectId)
    : await initializeMonitoring(engine.store, projectId);
  const repositories = await readHeads(engine, project);
  const looked = await optionalJson<Looked>(lookedFile(engine, projectId));
  const changed =
    !!looked &&
    repositories.some(
      (r) =>
        r.sha && looked.repositories.find((l) => l.repositoryId === r.repositoryId)?.sha !== r.sha,
    );
  const ready = !!(await optionalJson(path.join(engine.store.project(projectId), 'baseline.json')));
  return {
    repositories,
    active: engine.isBusy(projectId),
    changed,
    ready,
    lastLookAt: looked?.at ?? null,
  };
}
