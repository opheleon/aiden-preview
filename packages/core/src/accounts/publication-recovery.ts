import { existsSync } from 'node:fs';
import path from 'node:path';

import type { AccountTask } from '../../../contracts/src/accounts-api.js';
import type { Project } from '../../../contracts/src/index.js';
import { MissingPublicationCommit, publishJobBranch } from '../../../tools/src/delivery-git.js';
import type { Engine } from '../engine.js';
import type { TaskControls, TaskOutput } from './runner.js';

/** Injectable publication boundary; recovery must never invoke a coding model. */
export const publicationRecoveryServices = { publish: publishJobBranch };

/** Reconcile every committed repository before acknowledging a previously interrupted delivery. */
export async function recoverPublication(
  engine: Engine,
  project: Project,
  task: AccountTask,
  controls: TaskControls,
): Promise<TaskOutput> {
  const checkpoint = structuredClone(task.execution!.checkpoint!);
  const urls: string[] = [];
  for (const reference of checkpoint.repositories) {
    controls.signal.throwIfAborted();
    await controls.authorize?.();
    const repo = project.repositories.find(
      (item) => item.source?.kind === 'github' && item.source.name === reference.repository,
    );
    if (!repo) throw new Error('The checkpoint repository is no longer connected to this project.');
    const match = /^aiden\/job-([a-f0-9-]+)$/.exec(reference.branch);
    if (!match) throw new Error('The checkpoint branch is not an Aiden delivery branch.');
    const root = path.join(engine.store.project(project.id), 'coding-worktrees', match[1]!);
    const nested = path.join(root, reference.repository.split('/')[1]!);
    const local = [nested, root].find((folder) => existsSync(path.join(folder, '.git')));
    controls.progress(`Recovering publication in ${reference.repository}`);
    try {
      reference.pullRequestUrl = await publicationRecoveryServices.publish({
        worktree: local ?? repo.path,
        repository: reference.repository,
        branch: reference.branch,
        baseBranch: reference.baseBranch,
        commit: reference.commit,
        remoteOnly: !local,
        title: `Aiden: ${task.title}`,
        body: [checkpoint.summary, 'Local checks:', ...checkpoint.checks].join('\n'),
        signal: controls.signal,
        ...(controls.authorize ? { authorize: controls.authorize } : {}),
      });
    } catch (error) {
      if (error instanceof MissingPublicationCommit && controls.block)
        await controls.block('Recover committed work from the previous machine', error.message);
      throw error;
    }
    urls.push(reference.pullRequestUrl);
    await controls.checkpoint?.(checkpoint);
  }
  return {
    documentChanged: false,
    result: {
      recovered: true,
      summary: checkpoint.summary,
      pullRequestUrls: urls,
      checks: checkpoint.checks,
    },
    followUps: [
      ...(checkpoint.openQuestions ?? []).map((item) => ({
        actor: 'human' as const,
        kind: 'coding-question',
        title: item.question.slice(0, 200),
        instructions: item.question,
        ...(item.assigneeUserId ? { assigneeUserId: item.assigneeUserId } : {}),
      })),
      {
        actor: 'human',
        kind: 'review-pr',
        title: 'Review and merge the recovered pull requests',
        instructions: [checkpoint.summary, ...urls].join('\n').slice(0, 20_000),
      },
    ],
  };
}
