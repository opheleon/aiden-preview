import type { AccountTask } from '../../../contracts/src/accounts-api.js';
import type { SetupProgress, SetupStepId } from '../../../contracts/src/guide.js';
import { setupStepOf, setupTaskKind, setupTasks } from '../../../contracts/src/task-model.js';
import type { Engine } from '../engine.js';
import { guideFacts } from '../guide-context.js';
import { guideClarifications } from '../guide-scope.js';
import { queueBuild } from './build-tasks.js';
import type { AccountsClient } from './client.js';
import { teamsDebug } from './debug.js';

/** The question Aiden is waiting on during step 1, if any; only a person can move it on. */
async function openQuestion(engine: Engine, projectId: string, step: SetupStepId) {
  if (step !== 'understand') return null;
  return (await guideClarifications(engine, projectId))[0]?.question ?? null;
}

/** Close queued setup tasks whose step is done or skipped here; returns the setup tasks still queued. */
async function closeFinished(
  client: AccountsClient,
  accountId: string,
  projectId: string,
  steps: SetupProgress['steps'],
): Promise<AccountTask[]> {
  const state = await client.state(accountId);
  const open = state.tasks.filter(
    (task) =>
      task.projectId === projectId &&
      task.actor === 'human' &&
      task.status === 'queued' &&
      setupStepOf(task.kind) !== null,
  );
  for (const task of open) {
    const step = steps.find((s) => s.id === setupStepOf(task.kind));
    if (step && (step.status === 'done' || step.status === 'skipped'))
      await client.done(task.id, { step: step.id, status: step.status });
  }
  return open;
}

/**
 * Keep a team project's setup steps for people on the team queue, so they show in every member's
 * My work. The person's next step is queued once (the dedupe key makes repeats harmless); a queued
 * setup task closes as soon as this machine sees its step done or skipped. Aiden's own steps are
 * not queued here: they run as agent tasks. Solo projects are left alone.
 * @param engine The local engine that holds the project's setup state.
 * @param client The Teams API client.
 * @param projectId The project to reconcile.
 */
export async function syncSetupTasks(
  engine: Engine,
  client: AccountsClient,
  projectId: string,
): Promise<void> {
  const { project, baseline, setup } = await guideFacts(engine, projectId);
  const accountId = project.account?.accountId;
  if (!accountId) return;
  const open = await closeFinished(client, accountId, projectId, setup.steps);
  const next = setup.steps.find((step) => step.id === setup.next);
  teamsDebug('setup-sync', {
    projectId,
    next: setup.next ?? null,
    steps: setup.steps.map((step) => `${step.id}:${step.status}`),
    open: open.map((task) => task.kind),
  });
  if (setup.complete && baseline) await queueBuild(engine, client, project, baseline);
  if (!next || open.some((task) => task.kind === setupTaskKind(next.id))) return;
  // Aiden's steps run as agent tasks, unless Aiden is waiting on a question only a person can answer.
  const question = await openQuestion(engine, projectId, next.id);
  if (setupTasks[next.id].who === 'Aiden' && !question) return;
  await client.enqueue(projectId, {
    actor: 'human',
    kind: setupTaskKind(next.id),
    title: question ? 'Answer Aiden’s question' : setupTasks[next.id].action,
    instructions: question ?? next.detail,
    dedupeKey: `setup:${projectId}:${next.id}`,
  });
}
