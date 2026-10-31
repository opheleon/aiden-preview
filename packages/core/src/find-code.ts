import path from 'node:path';

import { ProjectSchema, type RunManifest } from '../../contracts/src/index.js';
import { publicError } from '../../runtimes/src/index.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import { parseGithubRepository, syncGithubRepository } from '../../tools/src/github.js';
import { atomic, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Most repositories copied for one project's plan. */
const copyLimit = 6;

/**
 * After planning, copy the repositories the requirements step found the work touches, read-only,
 * and save them as the project's code, so checks and estimates can read them. Only repositories
 * in the project's own GitHub organizations are copied, and only when no code is connected yet.
 * Each copy is reported live; a copy that fails is reported and skipped, never failing the run.
 * Example: namedRepositories ["opheleon/aiden-preview"] copies that one repository.
 * @param context The workflow's store and event stream.
 * @param run The prepare run; its project gains the copied repositories.
 * @param named The owner/name repositories the requirements step named.
 * @param signal Stops the copies when the run is cancelled.
 */
export async function copyNamedCode(
  context: WorkflowContext,
  run: RunManifest,
  named: string[] | undefined,
  signal: AbortSignal,
): Promise<void> {
  const organizations = new Set(
    (run.project.githubOrganizations ?? []).map((o) => o.toLowerCase()),
  );
  if (!organizations.size || run.project.repositories.length) return;
  const wanted = (named ?? [])
    .flatMap((link) => parseGithubRepository(link) ?? [])
    .filter((repo) => organizations.has(repo.owner.toLowerCase()))
    .slice(0, copyLimit);
  if (!wanted.length) return;
  /** Say what Aiden is doing in the chat as it happens. */
  const say = (message: string) =>
    context.emit({
      type: 'progress',
      runId: run.id,
      projectId: run.projectId,
      stage: run.stage,
      message,
    });
  say(`Copying ${wanted.map((r) => `${r.owner}/${r.name}`).join(', ')} read-only`);
  const root = path.join(context.store.project(run.projectId), 'code');
  const repositories = [];
  for (const repo of wanted) {
    try {
      repositories.push(await syncGithubRepository(root, repo, signal));
    } catch (error) {
      signal.throwIfAborted();
      say(`Could not copy ${repo.owner}/${repo.name}: ${publicError(error)}`);
    }
  }
  if (!repositories.length) return;
  // The run already holds the project lock, so the project file is saved here directly.
  const file = path.join(context.store.project(run.projectId), 'project.json');
  const updated = {
    ...ProjectSchema.parse((await optionalJson(file)) ?? run.project),
    repositories,
  };
  delete updated.rootPath;
  const next = await validateProjectRepositories(ProjectSchema.parse(updated));
  await atomic(file, next);
  run.project = { ...run.project, repositories: next.repositories };
}
