import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  Baseline,
  LookReason,
  Project,
  RunManifest,
  Stage,
} from '../../contracts/src/index.js';
import { scopeName } from '../../contracts/src/project-name.js';
import { publicError } from '../../runtimes/src/index.js';
import { withMonitoredBranches } from '../../tools/src/remote-branches.js';
import { execute } from './report-workflow.js';
import { atomic, json, optionalJson, type Store, uid } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** A run executing in this worker, with its cancellation handle and completion promise. */
export type ActiveRun = { controller: AbortController; done: Promise<void>; projectId: string };

/** Optional manifest fields a caller can attach when starting a run. */
export type RunExtras = {
  runId?: string;
  beta?: NonNullable<RunManifest['beta']>;
  estimateReportId?: string;
  refreshHistory?: boolean;
  verifyUrl?: string;
  autoAccept?: boolean;
  reason?: LookReason;
};

/** Stage recorded before each kind of run starts working. */
const firstStage: Record<RunManifest['kind'], Stage> = {
  prepare: 'understand',
  report: 'sync',
  estimate: 'estimate',
  verify: 'verify',
};

/** Longest a single run may execute before it is aborted as timed out. */
const runTimeoutMs = 30 * 60 * 1000;

/** Acquire a per-project filesystem lock; remove only dead-process locks and release only our own token. */
export async function acquireProjectLock(
  store: Store,
  projectId: string,
  name: 'active' | 'browser' = 'active',
): Promise<() => Promise<void>> {
  const folder = store.project(projectId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, `${name}.lock`);
  const token = uid();
  try {
    const h = await open(file, 'wx', 0o600);
    await h.writeFile(JSON.stringify({ pid: process.pid, token }));
    await h.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const previous = await json<{ pid: number }>(file);
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (e) {
      alive = (e as NodeJS.ErrnoException).code !== 'ESRCH';
    }
    if (alive) throw new Error('This project already has an active operation.', { cause: e });
    await unlink(file);
    return acquireProjectLock(store, projectId, name);
  }
  return async () => {
    const current = await optionalJson<{ token: string }>(file);
    if (current?.token === token) await unlink(file);
  };
}

/** Persist a new run manifest and the project it runs against; the caller holds the project lock. */
export async function createRun(
  store: Store,
  project: Project,
  kind: RunManifest['kind'],
  baseline?: Baseline,
  extra: RunExtras = {},
): Promise<RunManifest> {
  if (kind === 'prepare') project = await withMonitoredBranches(project);
  project = { ...project, name: scopeName(project.context, baseline?.product) };
  // A look reads only the repositories what done means is about; the saved project keeps them all.
  const scope = kind === 'report' ? baseline?.product.repositories : undefined;
  const scoped = scope?.length
    ? { ...project, repositories: project.repositories.filter((r) => scope.includes(r.id)) }
    : project;
  const run: RunManifest & RunExtras = {
    id: extra.runId ?? uid(),
    projectId: project.id,
    kind,
    status: 'running',
    stage: firstStage[kind],
    project: scoped.repositories.length ? scoped : project,
    ...(baseline ? { baseline } : {}),
    createdAt: new Date().toISOString(),
    latestAtStart:
      (await optionalJson<{ id: string }>(path.join(store.project(project.id), 'latest.json')))
        ?.id ?? null,
    ...extra,
  };
  // Only a rewrite can change the project; other runs read it, so they never overwrite a newer one.
  if (kind === 'prepare')
    await atomic(path.join(store.project(project.id), 'project.json'), project);
  await atomic(path.join(store.run(project.id, run.id), 'manifest.json'), run);
  return run;
}

/** Track one bounded workflow and retain failure details in its manifest without automatic retries. */
export function launchRun(
  context: WorkflowContext,
  run: RunManifest,
  release: () => Promise<void>,
  active: Map<string, ActiveRun>,
): void {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Run exceeded 30 minutes.')),
    runTimeoutMs,
  );
  const done = execute(context, run, controller.signal)
    .catch(async (e) => {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = controller.signal.aborted ? 'Run cancelled or timed out.' : publicError(e);
      await atomic(path.join(context.store.run(run.projectId, run.id), 'manifest.json'), run);
      context.emit({
        type: run.status,
        runId: run.id,
        projectId: run.projectId,
        message: run.error,
      });
    })
    .finally(async () => {
      clearTimeout(timer);
      try {
        await release();
      } finally {
        active.delete(run.id);
      }
    });
  // The worker starts runs without waiting; wait() still exposes persistence or cleanup failures.
  void done.catch(() => {});
  active.set(run.id, { controller, done, projectId: run.projectId });
}
