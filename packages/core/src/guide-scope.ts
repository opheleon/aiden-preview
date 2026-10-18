import type { Baseline, Call } from '../../contracts/src/index.js';
import { answerCall, answeredDecisions, readCalls } from './calls.js';
import type { Engine } from './engine.js';
import { hash } from './storage.js';

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

/** Save an explicit answer; rewrite once all questions are answered, without starting any check. */
export async function answerGuideClarification(
  engine: Engine,
  projectId: string,
  callId: string,
  answer: string,
): Promise<string> {
  if (engine.isBusy(projectId))
    throw new Error('Wait for the current work to finish before answering.');
  const call = (await guideClarifications(engine, projectId)).find((item) => item.id === callId);
  if (!call) throw new Error('This question is no longer waiting for an answer.');
  await answerCall(engine.store, projectId, callId, answer);
  if ((await guideClarifications(engine, projectId)).length) return 'Got it.';
  await rewriteGuideRequirements(engine, projectId);
  return 'Got it. I’m updating the requirements with your choices for you to review.';
}

/** Retry a failed scope rewrite using saved answers, with confirmation still required afterward. */
export async function rewriteGuideRequirements(engine: Engine, projectId: string): Promise<void> {
  const { project } = await engine.state(projectId);
  if (!project) throw new Error('This project is not saved yet.');
  await engine.prepare(project, { autoAccept: true, reason: 'answer' });
}
