import { existsSync } from 'node:fs';
import path from 'node:path';

import type {
  AccountProject,
  AccountTask,
  NewAccountTask,
} from '../../../contracts/src/accounts-api.js';
import type {
  DeliveryCheckpoint,
  ExecutionActivity,
  ExecutionLimits,
} from '../../../contracts/src/accounts-execution.js';
import type { Baseline, CodingJob, Project, RunManifest } from '../../../contracts/src/index.js';
import type { LocalToolServer } from '../../../tools/src/mcp.js';
import { codingAgent } from '../coding-jobs.js';
import type { Engine } from '../engine.js';
import { connectGithubCode } from '../github-code.js';
import { json, optionalJson } from '../storage.js';
import { runTeamCoding } from '../team-coding.js';
import { buildRepositories } from './build-tasks.js';
import { materialize } from './documents.js';
import { recoverPublication } from './publication-recovery.js';

/** A task kind this version of the app does not run yet; reported as a failed attempt. */
export class UnsupportedTask extends Error {
  /** Explain which task could not run. */
  constructor(title: string) {
    super(`This version of Aiden cannot do "${title}" yet. Update Aiden to pick it up.`);
    this.name = 'UnsupportedTask';
  }
}

/** What a finished account task hands back to the server. */
export interface TaskOutput {
  result: unknown;
  /** True when the project's document changed and should be uploaded. */
  documentChanged: boolean;
  /** Work for people that this result creates, for example reviewing a pull request. */
  followUps?: NewAccountTask[];
}

/** How a running task reports progress and learns it was stopped. */
export interface TaskControls {
  limits?: ExecutionLimits;
  progress: (line: string) => void;
  signal: AbortSignal;
  tools?: LocalToolServer;
  activity?: (activity: ExecutionActivity) => void;
  authorize?: () => Promise<void>;
  checkpoint?: (checkpoint: DeliveryCheckpoint) => Promise<void>;
  block?: (title: string, question: string) => Promise<void>;
}

/**
 * The person's next step after a coding session: review its PRs, or answer what it needs.
 * Example: PRs in acme/api and acme/ui become "Review and merge 2 pull requests" listing both.
 */
function codingFollowUp(job: CodingJob, pullRequests: string[], verdict: string[]): NewAccountTask {
  if (pullRequests.length)
    return {
      actor: 'human',
      kind: 'review-pr',
      title:
        pullRequests.length === 1
          ? 'Review and merge the pull request'
          : `Review and merge ${pullRequests.length} pull requests`,
      instructions: [...verdict, ...pullRequests, '', job.message].join('\n').slice(0, 4000),
    };
  const takeOver =
    job.runtime.provider === 'claude'
      ? `run claude --resume ${job.sessionId} in ${job.worktree}`
      : `open ${job.worktree}`;
  return {
    actor: 'human',
    kind: 'coding-question',
    title: `Answer ${codingAgent(job.runtime)}`,
    instructions: `${job.message}\nTo take over, ${takeOver} on the machine that ran it.`.slice(
      0,
      4000,
    ),
  };
}

/**
 * What the team must answer before a stopped build can continue: the agent's blocking questions,
 * or its summary when it stopped without asking one.
 * Example: blocking questions "Which Zoom app?" and "Who owns OAuth?" become a numbered list of both.
 */
function blockingQuestions(job: CodingJob): string {
  const blocking = (job.openQuestions ?? []).filter((item) => item.blocking);
  const text = blocking.length
    ? blocking.map((item, index) => `${index + 1}. ${item.question}`).join('\n')
    : job.message;
  return text.slice(0, 5000);
}

/** Hand the change to the project's coding agent on this machine and report its PR, or why it stopped. */
async function build(
  engine: Engine,
  task: AccountTask,
  project: Project,
  controls: TaskControls,
): Promise<TaskOutput> {
  const { job, pullRequests, verdict } = await runTeamCoding(
    engine,
    project.id,
    task.resume
      ? `${task.instructions}\n<human_answer>${JSON.stringify(task.resume)}</human_answer>`
      : task.instructions,
    controls.progress,
    controls.signal,
    buildRepositories(task.instructions),
    task.requirementIds,
    controls,
  );
  if (job.status === 'failed' || job.status === 'interrupted') throw new Error(job.message);
  if (job.status === 'needs_input' && controls.block) {
    await controls.block('Coding needs a human answer', blockingQuestions(job));
    controls.signal.throwIfAborted();
  }
  return {
    result: {
      jobId: job.id,
      sessionId: job.sessionId,
      status: job.status,
      summary: job.message,
      pullRequestUrls: pullRequests,
      verdict,
      checks: job.checks,
    },
    documentChanged: false,
    followUps: [
      codingFollowUp(job, pullRequests, verdict),
      ...(job.openQuestions ?? []).map((item) => ({
        actor: 'human' as const,
        kind: 'coding-question',
        title: item.question.slice(0, 200),
        instructions: item.question,
        ...(item.assigneeUserId ? { assigneeUserId: item.assigneeUserId } : {}),
      })),
    ],
  };
}

/** Run an engine operation to the end and fail with the run's own message if it did not complete. */
async function finish(
  engine: Engine,
  projectId: string,
  runId: string,
  label: string,
): Promise<RunManifest> {
  await engine.wait(runId);
  const run = await json<RunManifest>(
    path.join(engine.store.run(projectId, runId), 'manifest.json'),
  );
  if (run.status !== 'completed') throw new Error(run.error ?? `${label} stopped (${run.status}).`);
  return run;
}

/**
 * Copy the project's GitHub repositories this machine has not copied yet, so the task reads the
 * same code as the member who connected it. Returns the project as saved after the copy.
 * Example: a teammate connected acme/web; the first task here clones it into this project's folder.
 */
async function ensureCode(engine: Engine, project: Project): Promise<Project> {
  const links = project.repositories.flatMap((repo) =>
    repo.source?.kind === 'github' ? [repo.source.name] : [],
  );
  const missing = project.repositories.some(
    (repo) => repo.source?.kind === 'github' && !existsSync(repo.path),
  );
  if (!missing) return project;
  try {
    await connectGithubCode(engine, project.id, links, { check: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the copy failed';
    throw new Error(`This machine could not copy the project's code from GitHub: ${reason}`, {
      cause: error,
    });
  }
  return (await engine.state(project.id)).project ?? project;
}

/**
 * Check the latest code against the requirements, the same check as Run the check now, and report
 * how many requirements it found met. The report stays on this machine like a solo check's.
 * Example: the team's Morning check on a project with 3 requirements returns `{ met: 1, total: 3 }`.
 */
async function checkCode(
  engine: Engine,
  project: Project,
  controls: TaskControls,
): Promise<TaskOutput> {
  controls.activity?.({ type: 'tool-start', id: 'check-code' });
  const { runId } = await engine.report(project.id, 'morning');
  /** Stop the check when the team stops the task. */
  const stop = (): void => {
    engine.cancel(runId);
  };
  controls.signal.addEventListener('abort', stop, { once: true });
  await finish(engine, project.id, runId, 'The code check').finally(() =>
    controls.signal.removeEventListener('abort', stop),
  );
  controls.activity?.({ type: 'tool-end', id: 'check-code' });
  controls.signal.throwIfAborted();
  const report = await engine.getReport(project.id, runId);
  return {
    result: {
      runId,
      met: report.assessments.filter((a) => a.status === 'implemented').length,
      total: report.assessments.length,
    },
    documentChanged: false,
  };
}

/** Task kinds `runAccountTask` can run; sent with every poll so the team only assigns these. */
export const supportedTaskKinds = ['write-requirements', 'check-code', 'build'] as const;

/**
 * Run one account task on this machine through the existing engine, with the project's own
 * provider and billing mode. Each kind maps to an operation the solo app already performs.
 */
export async function runAccountTask(
  engine: Engine,
  task: AccountTask,
  server: AccountProject,
  controls: TaskControls,
): Promise<TaskOutput> {
  controls.signal.throwIfAborted();
  await controls.authorize?.();
  const materialized = await materialize(engine, server, true);
  if (!materialized)
    throw new Error(
      'This project was saved by a newer version of Aiden. Update Aiden to work on it.',
    );
  controls.activity?.({ type: 'tool-start', id: 'prepare-code' });
  const project = await ensureCode(engine, materialized);
  controls.activity?.({ type: 'tool-end', id: 'prepare-code' });
  controls.signal.throwIfAborted();
  if (task.execution?.checkpoint) return recoverPublication(engine, project, task, controls);
  switch (task.kind) {
    case 'write-requirements': {
      controls.activity?.({ type: 'tool-start', id: 'write-requirements' });
      const { runId } = await engine.prepare(project, { autoAccept: true });
      await finish(engine, project.id, runId, 'Writing requirements');
      controls.activity?.({ type: 'tool-end', id: 'write-requirements' });
      controls.signal.throwIfAborted();
      const baseline = await optionalJson<Baseline>(
        path.join(engine.store.project(project.id), 'baseline.json'),
      );
      return {
        result: { runId, requirements: baseline?.product.requirements.length ?? 0 },
        documentChanged: true,
      };
    }
    case 'check-code':
      return checkCode(engine, project, controls);
    case 'build':
      return build(engine, task, project, controls);
    default:
      throw new UnsupportedTask(task.title);
  }
}
