import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  type Baseline,
  type Discovery,
  type EstimationSnapshot,
  EstimationSnapshotSchema,
  type Evidence,
  type Project,
  ProjectSchema,
  type ReadReceipt,
  type Report,
  type RunManifest,
  validateReport,
} from '../../contracts/src/index.js';
import { scopeName } from '../../contracts/src/project-name.js';
import { isBlocking } from '../../reporting/src/blockers.js';
import { markdown, markdownBundle } from '../../reporting/src/index.js';
import { readSnapshot } from '../../tools/src/git.js';
import { readCalls } from './calls.js';
import { lifecycleView } from './project-lifecycle.js';
import { hash, json, optionalJson, type Store } from './storage.js';

/** List saved project metadata; a new home returns no projects, while corruption remains an error. */
export async function listProjects(store: Store): Promise<Project[]> {
  try {
    const ids = await readdir(path.join(store.root, 'projects'));
    return (await Promise.all(ids.map((p) => readProject(store, p)))).filter(
      (project): project is Project => project !== null,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Resolve the display name from saved scope without rewriting project identity or history. */
export async function readProject(store: Store, projectId: string): Promise<Project | null> {
  const folder = store.project(projectId);
  const project = await optionalJson<Project>(path.join(folder, 'project.json'));
  if (!project) return null;
  const baseline = await optionalJson<Baseline>(path.join(folder, 'baseline.json'));
  return {
    ...project,
    name: scopeName(project.context, baseline?.product),
    lifecycle: await lifecycleView(store, project),
  };
}

/** List persisted run manifests newest first, excluding directories without a manifest. */
export async function runHistory(store: Store, projectId: string): Promise<RunManifest[]> {
  const rows = await Promise.all(
    (await store.listRuns(projectId)).map((r) =>
      optionalJson<RunManifest>(path.join(store.run(projectId, r), 'manifest.json')),
    ),
  );
  return rows
    .filter((r): r is RunManifest => !!r)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Revalidate an accepted report against its saved baseline, snapshots, and read receipts. */
export async function readAcceptedReport(
  store: Store,
  projectId: string,
  runId?: string,
): Promise<Report> {
  const resolved =
    runId ?? (await json<{ id: string }>(path.join(store.project(projectId), 'latest.json'))).id;
  const dir = store.run(projectId, resolved);
  const r = await json<Report>(path.join(dir, 'report.json'));
  const run = await json<RunManifest>(path.join(dir, 'manifest.json'));
  if (run.status !== 'completed') throw new Error('This run has no accepted report.');
  if (!run.baseline) throw new Error('Missing report baseline.');
  if (r.id !== resolved || run.id !== resolved || run.projectId !== projectId)
    throw new Error('Report run identity mismatch.');
  return validateReport(
    r,
    run.baseline,
    (await json<Discovery>(path.join(dir, 'discover.json'))).snapshots,
    await json<ReadReceipt[]>(path.join(dir, 'reads.json')),
  );
}

/** Return only estimates matching current baseline, source consent, and accepted report identity. */
export async function readCurrentEstimate(
  store: Store,
  projectId: string,
): Promise<EstimationSnapshot | null> {
  const folder = store.project(projectId);
  if ((await readCalls(store, projectId)).some(isBlocking)) return null;
  const pointer = await optionalJson<{ id: string }>(path.join(folder, 'latest-estimate.json'));
  if (!pointer) return null;
  const snapshot = EstimationSnapshotSchema.parse(
    await json(path.join(folder, 'estimates', `${pointer.id}.json`)),
  );
  const baseline = await optionalJson<Baseline>(path.join(folder, 'baseline.json'));
  if (!baseline || snapshot.baselineId !== baseline.id) return null;
  const latestReport = await optionalJson<{ id: string }>(path.join(folder, 'latest.json'));
  if (snapshot.reportId && latestReport?.id !== snapshot.reportId) return null;
  const project = ProjectSchema.parse(await json(path.join(folder, 'project.json')));
  if (
    snapshot.sourceSelectionHash !==
    hash(project.sources ?? { contextConnectionIds: [], history: null })
  )
    return null;
  return snapshot;
}

/** Export only accepted reports, optionally requiring an estimate tied to that exact report. */
export async function exportReport(
  store: Store,
  projectId: string,
  runId: string,
  format: 'json' | 'markdown',
  includeEstimates = false,
): Promise<string> {
  const r = await readAcceptedReport(store, projectId, runId);
  if (!includeEstimates) return format === 'json' ? JSON.stringify(r, null, 2) : markdown(r);
  const estimate = await readCurrentEstimate(store, projectId);
  if (!estimate || estimate.reportId !== r.id)
    throw new Error('No accepted estimation snapshot matches this report. Re-estimate first.');
  return format === 'json'
    ? JSON.stringify({ schemaVersion: '1.0', projectId, report: r, estimation: estimate }, null, 2)
    : markdownBundle(r, estimate);
}

/** Read cited lines from the run's independent frozen objects, even if the source checkout later changes. */
export async function readEvidence(
  store: Store,
  projectId: string,
  runId: string,
  index: number,
  evidenceIndex: number,
): Promise<Evidence & { text: string }> {
  const r = await readAcceptedReport(store, projectId, runId);
  const e = r.assessments[index]?.evidence[evidenceIndex];
  if (!e) throw new Error('Evidence not found.');
  const run = await json<RunManifest>(path.join(store.run(projectId, runId), 'manifest.json'));
  const repo = run.project.repositories.find((x) => x.id === e.repositoryId)!;
  const s = r.snapshots.find((x) => x.repositoryId === e.repositoryId && x.sha === e.sha)!;
  const text = await readSnapshot(
    { ...repo, path: path.join(store.run(projectId, runId), 'snapshots', repo.id) },
    s,
    e.path,
  );
  return {
    ...e,
    text: text
      .split('\n')
      .slice(e.startLine - 1, e.endLine)
      .map((l, i) => `${i + e.startLine}: ${l}`)
      .join('\n'),
  };
}
