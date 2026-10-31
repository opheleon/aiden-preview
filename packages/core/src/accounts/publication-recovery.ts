import { existsSync } from 'node:fs';
import path from 'node:path';

import type { AccountTask } from '../../../contracts/src/accounts-api.js';
import type { Project } from '../../../contracts/src/index.js';
import { MissingPublicationCommit, publishJobBranch } from '../../../tools/src/delivery-git.js';
import type { Engine } from '../engine.js';
import { questionTasks, recoveredReview } from './review-packet.js';
import type { TaskControls, TaskOutput } from './runner.js';

/** Injectable publication boundary; recovery must never invoke a coding model. */
export const publicationRecoveryServices = { publish: publishJobBranch };

/**
 * Reconcile every committed repository before acknowledging a previously interrupted delivery.
 * The recovered pull requests go to the task's reviewer as a review packet, and saved questions
 * become routed question tasks.
 */
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
        await controls.block('Recover committed work from the previous machine', error.message, {
          ...(task.role ? { role: task.role } : {}),
          scope: 'task',
        });
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
    followUps: questionTasks(checkpoint.openQuestions ?? [], task.role),
    review: recoveredReview(checkpoint.summary, urls),
  };
}
