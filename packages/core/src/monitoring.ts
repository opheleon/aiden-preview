import { rm } from 'node:fs/promises';
import path from 'node:path';

import { type Project, ProjectSchema } from '../../contracts/src/index.js';
import {
  type MonitoredBranch,
  monitoredHead,
  remoteBranches,
  withMonitoredBranches,
} from '../../tools/src/remote-branches.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { atomic, json, type Store } from './storage.js';

/** Retain historical artifacts while removing current evidence from the previous branch selection. */
async function clearCurrent(store: Store, projectId: string): Promise<void> {
  for (const file of [
    'latest.json',
    'latest-estimate.json',
    'latest-verification.json',
    'looked-heads.json',
  ])
    await rm(path.join(store.project(projectId), file), { force: true });
}

/** Pin legacy projects to their current branch once; caller must ensure no active project operation. */
export async function initializeMonitoring(store: Store, projectId: string): Promise<Project> {
  const file = path.join(store.project(projectId), 'project.json');
  const previous = ProjectSchema.parse(await json(file));
  if (previous.repositories.every((repo) => repo.monitoredBranch)) return previous;
  const release = await acquireProjectLock(store, projectId);
  let releaseBrowser: (() => Promise<void>) | undefined;
  try {
    releaseBrowser = await acquireProjectLock(store, projectId, 'browser');
    const saved = ProjectSchema.parse(await json(file));
    const project = await withMonitoredBranches(saved);
    if (JSON.stringify(saved) !== JSON.stringify(project)) {
      await clearCurrent(store, projectId);
      await atomic(file, project);
    }
    return project;
  } finally {
    await releaseBrowser?.();
    await release();
  }
}

/** List live remote branches only for a repository belonging to this saved project. */
export async function monitoringBranches(
  store: Store,
  projectId: string,
  repositoryId: string,
): Promise<{ branches: MonitoredBranch[]; warnings: string[] }> {
  const project = ProjectSchema.parse(
    await json(path.join(store.project(projectId), 'project.json')),
  );
  const repo = project.repositories.find((r) => r.id === repositoryId);
  if (!repo) throw new Error('Unknown project repository.');
  return remoteBranches(repo);
}

/** Save a verified project-specific selection under the project lock and discard stale current results. */
export async function saveMonitoredBranch(
  store: Store,
  projectId: string,
  repositoryId: string,
  monitoredBranch: MonitoredBranch,
): Promise<Project> {
  const release = await acquireProjectLock(store, projectId);
  let releaseBrowser: (() => Promise<void>) | undefined;
  try {
    releaseBrowser = await acquireProjectLock(store, projectId, 'browser');
    const file = path.join(store.project(projectId), 'project.json');
    const project = ProjectSchema.parse(await json(file));
    const repo = project.repositories.find((r) => r.id === repositoryId);
    if (!repo) throw new Error('Unknown project repository.');
    await monitoredHead({ ...repo, monitoredBranch });
    if (JSON.stringify(repo.monitoredBranch) !== JSON.stringify(monitoredBranch)) {
      repo.monitoredBranch = monitoredBranch;
      await clearCurrent(store, projectId);
      await atomic(file, project);
    }
    return project;
  } finally {
    await releaseBrowser?.();
    await release();
  }
}
