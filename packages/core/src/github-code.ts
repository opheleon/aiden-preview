import path from 'node:path';

import type { Project } from '../../contracts/src/index.js';
import { parseGithubRepository, syncGithubRepository } from '../../tools/src/github.js';
import type { Engine } from './engine.js';
import { startLook } from './look.js';

/** The project's own code folder, where Aiden keeps a fresh read-only clone of each repository. */
export function projectCodeFolder(engine: Engine, projectId: string): string {
  return path.join(engine.store.project(projectId), 'code');
}

/**
 * Connect a project's code by GitHub links: clone each repository into the project's own folder
 * the first time, so projects never share or disturb each other's copies, fetch it afterwards, and save them as the project's repositories without rewriting its requirements.
 * Notes and monitored branches carry over for repositories that were already connected. With
 * agreed requirements, a code check starts so Aiden reads the code and estimates the work.
 * Example: ["https://github.com/acme/web", "acme/api"] connects both and starts a check.
 */
export async function connectGithubCode(
  engine: Engine,
  projectId: string,
  links: string[],
): Promise<{ runId: string | null; repositories: Project['repositories'] }> {
  const wanted = links.map((link) => {
    const parsed = parseGithubRepository(link);
    if (!parsed) throw new Error(`${link.trim()} is not a GitHub repository link.`);
    return parsed;
  });
  const unique = wanted.filter(
    (repo, index) =>
      wanted.findIndex(
        (other) =>
          other.owner.toLowerCase() === repo.owner.toLowerCase() &&
          other.name.toLowerCase() === repo.name.toLowerCase(),
      ) === index,
  );
  const saved = (await engine.state(projectId)).project;
  const repositories: Project['repositories'] = [];
  for (const repo of unique) {
    const synced = await syncGithubRepository(projectCodeFolder(engine, projectId), repo);
    const previous = saved?.repositories.find((existing) => existing.id === synced.id);
    repositories.push({
      ...synced,
      notes: previous?.notes ?? '',
      ...(previous?.monitoredBranch ? { monitoredBranch: previous.monitoredBranch } : {}),
    });
  }
  await engine.updateCode(projectId, repositories);
  const { baseline } = await engine.state(projectId);
  const look = baseline && repositories.length ? await startLook(engine, projectId, 'you') : null;
  return { runId: look?.runId ?? null, repositories };
}
