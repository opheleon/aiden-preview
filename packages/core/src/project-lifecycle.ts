import path from 'node:path';

import {
  type Project,
  type ProjectLifecycle,
  ProjectLifecycleSchema,
} from '../../contracts/src/index.js';
import { codingActive, codingJobs } from './coding-jobs.js';
import type { Engine } from './engine.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { atomic, hash, optionalJson, type Store } from './storage.js';

/** Read trusted lifecycle storage rather than metadata supplied by a renderer or saved run. */
export async function readLifecycle(store: Store, projectId: string): Promise<ProjectLifecycle> {
  return ProjectLifecycleSchema.parse(
    (await optionalJson(path.join(store.project(projectId), 'lifecycle.json'))) ?? {
      status: 'active',
      history: [],
    },
  );
}
/** Require an open project before starting work, including detached workflow follow-ups. */
export async function requireOpenProject(store: Store, projectId: string): Promise<void> {
  if ((await readLifecycle(store, projectId)).status === 'closed')
    throw new Error('This project is closed. Reopen it to continue work.');
}
/** Bind acceptance to intent, branch selections, baseline, and the exact saved code and app checks. */
export async function lifecycleView(
  store: Store,
  project: Project,
): Promise<NonNullable<Project['lifecycle']>> {
  const folder = store.project(project.id);
  const evidence = await Promise.all(
    [
      'baseline.json',
      'latest.json',
      'latest-verification.json',
      'calls.json',
      'confirmed.json',
    ].map((file) => optionalJson(path.join(folder, file))),
  );
  const evidenceKey = hash([project.context, project.repositories, ...evidence]);
  const saved = await readLifecycle(store, project.id);
  return {
    ...saved,
    evidenceKey,
    acceptanceCurrent: saved.acceptance?.evidenceKey === evidenceKey,
  };
}
/** Hold both run locks so an acceptance or closure cannot race a code or browser result. */
async function decisionLocks(store: Store, projectId: string): Promise<() => Promise<void>> {
  const releases: (() => Promise<void>)[] = [];
  try {
    for (const name of ['active', 'browser', 'delivery'] as const)
      releases.push(await acquireProjectLock(store, projectId, name));
    return async () => {
      for (const release of releases.reverse()) await release();
    };
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
}
/** Save an explicit human decision without changing reports, requirement verdicts, or external tickets. */
export async function decideProject(
  engine: Engine,
  projectId: string,
  decision: { action: 'accepted' | 'closed' | 'reopened'; note: string; evidenceKey?: string },
): Promise<Project> {
  const release = await decisionLocks(engine.store, projectId);
  try {
    if ((await codingJobs(engine, projectId)).some((job) => codingActive(engine, job.id)))
      throw new Error('Stop the active coding job before accepting or closing this project.');
    const folder = engine.store.project(projectId);
    const project = (await engine.state(projectId)).project;
    if (!project) throw new Error('Save the project first.');
    const view = await lifecycleView(engine.store, project);
    const saved = await readLifecycle(engine.store, projectId);
    const at = new Date().toISOString();
    if (decision.action === 'accepted') {
      await requireOpenProject(engine.store, projectId);
      if (!(await optionalJson(path.join(folder, 'baseline.json'))))
        throw new Error('Define what done means before accepting the outcome.');
      if (decision.evidenceKey !== view.evidenceKey)
        throw new Error(
          'The scope or evidence changed. Review the latest project before accepting.',
        );
      saved.acceptance = { at, note: decision.note, evidenceKey: view.evidenceKey };
    } else {
      const status = decision.action === 'closed' ? 'closed' : 'active';
      if (saved.status === status) return { ...project, lifecycle: view };
      saved.status = status;
    }
    saved.history.push({ ...decision, at });
    await atomic(path.join(folder, 'lifecycle.json'), ProjectLifecycleSchema.parse(saved));
    return { ...project, lifecycle: await lifecycleView(engine.store, project) };
  } finally {
    await release();
  }
}
