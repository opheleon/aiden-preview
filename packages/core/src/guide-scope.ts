import { setTimeout as delay } from 'node:timers/promises';

import type { Baseline, Call } from '../../contracts/src/index.js';
import { publicError } from '../../runtimes/src/index.js';
import { answerCall, answeredDecisions, readCalls } from './calls.js';
import type { Engine } from './engine.js';
import { recordGuideEvent } from './guide.js';
import { lookInProgress } from './look.js';
import { readLifecycle } from './project-lifecycle.js';
import { hash } from './storage.js';

/** How often a saved answer checks whether the project's current work has ended; tests shorten it. */
export const deferredAnswers = { pollMs: 1000 };

/** Rewrites waiting for the current work to end, per worker engine; one per project. */
const waiting = new WeakMap<Engine, Set<string>>();

/** Questions that must be answered before draft scope can become confirmed requirements. */
export async function guideClarifications(engine: Engine, projectId: string): Promise<Call[]> {
  return (await readCalls(engine.store, projectId)).filter(
    (call) => call.kind === 'decision' && call.status === 'open' && call.blocking !== false,
  );
}

/** Answers remain pending until a new baseline incorporates them, including after a failed rewrite. */
export async function guideRequirementsPending(
  engine: Engine,
  projectId: string,
  baseline: Baseline | null,
): Promise<boolean> {
  if (!baseline) return true;
  if (baseline.decisionsHash !== undefined)
    return baseline.decisionsHash !== hash(await answeredDecisions(engine.store, projectId));
  return (await readCalls(engine.store, projectId)).some(
    (call) =>
      call.kind === 'decision' &&
      call.status === 'answered' &&
      !!call.answeredAt &&
      call.answeredAt > baseline.reviewedAt,
  );
}

/** Reject stale confirmation and setup checks even when a model or old client requests them. */
export async function requireGuideScope(engine: Engine, projectId: string): Promise<void> {
  if ((await guideClarifications(engine, projectId)).length)
    throw new Error(
      'Answer the questions in this chat before confirming requirements or running a check.',
    );
  const { baseline, runs } = await engine.state(projectId);
  const rewriting = runs.some((run) => run.kind === 'prepare' && engine.isActive(run.id));
  if (rewriting || (await guideRequirementsPending(engine, projectId, baseline)))
    throw new Error('The requirements need to be updated with your answers before continuing.');
}

/**
 * Save an explicit answer; rewrite once all questions are answered, without starting any check.
 * While other work runs on the project, such as a code check, the answer is still saved now and
 * the rewrite starts when that work ends, so the person never answers twice. The returned text
 * says which of the two happened.
 */
export async function answerGuideClarification(
  engine: Engine,
  projectId: string,
  callId: string,
  answer: string,
): Promise<string> {
  const call = (await guideClarifications(engine, projectId)).find((item) => item.id === callId);
  if (!call) throw new Error('This question is no longer waiting for an answer.');
  await answerCall(engine.store, projectId, callId, answer);
  if ((await guideClarifications(engine, projectId)).length) return 'Got it.';
  if (workRunning(engine, projectId)) {
    rewriteAfterWork(engine, projectId);
    return 'Got it. Your answer is saved. Aiden will update the requirements with it as soon as the current work finishes.';
  }
  await rewriteGuideRequirements(engine, projectId);
  return 'Got it. I’m updating the requirements with your choices for you to review.';
}

/** Whether the project has work running now or a look about to start its next step. */
function workRunning(engine: Engine, projectId: string): boolean {
  return engine.isBusy(projectId) || lookInProgress(engine, projectId);
}

/**
 * Start the rewrite of saved answers once the project's current work ends, and record in the
 * chat when it starts or why it could not. One waiter per project serves every saved answer.
 */
function rewriteAfterWork(engine: Engine, projectId: string): void {
  const projects = waiting.get(engine) ?? new Set<string>();
  waiting.set(engine, projects);
  if (projects.has(projectId)) return;
  projects.add(projectId);
  void rewriteWhenIdle(engine, projectId)
    .then((started) =>
      started
        ? recordGuideEvent(
            engine,
            projectId,
            'The current work finished. Aiden is updating the requirements with your answers.',
          )
        : null,
    )
    .catch((error: unknown) =>
      recordGuideEvent(
        engine,
        projectId,
        `Aiden could not update the requirements with your answers: ${publicError(error)} Ask the Guide to try again.`,
      ),
    )
    .catch(() => {
      // The answers stay saved; the Guide offers the rewrite again while they are pending.
    })
    .finally(() => projects.delete(projectId));
}

/**
 * Wait until nothing runs on the project, then rewrite if saved answers still need it. Work that
 * takes the project first, such as sizing after a check, is waited for too. Returns whether a
 * rewrite started; nothing starts once answers are already incorporated or the project closed.
 */
async function rewriteWhenIdle(engine: Engine, projectId: string): Promise<boolean> {
  for (;;) {
    while (workRunning(engine, projectId))
      await delay(deferredAnswers.pollMs, undefined, { ref: false });
    if (engine.isClosing() || !(await rewriteNeeded(engine, projectId))) return false;
    try {
      await rewriteGuideRequirements(engine, projectId);
      return true;
    } catch (error) {
      if (!workRunning(engine, projectId)) throw error;
    }
  }
}

/** Whether saved answers are complete and not yet in the requirements of an open project. */
async function rewriteNeeded(engine: Engine, projectId: string): Promise<boolean> {
  if ((await readLifecycle(engine.store, projectId)).status === 'closed') return false;
  if ((await guideClarifications(engine, projectId)).length) return false;
  const { baseline } = await engine.state(projectId);
  return guideRequirementsPending(engine, projectId, baseline);
}

/** Retry a failed scope rewrite using saved answers, with confirmation still required afterward. */
export async function rewriteGuideRequirements(engine: Engine, projectId: string): Promise<void> {
  const { project } = await engine.state(projectId);
  if (!project) throw new Error('This project is not saved yet.');
  await engine.prepare(project, { autoAccept: true, reason: 'answer' });
}
