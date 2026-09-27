import path from 'node:path';

import {
  type Baseline,
  type Discovery,
  DiscoverySchema,
  type Findings,
  FindingsSchema,
  type ReadReceipt,
  type Report,
  type RunManifest,
  type Stage,
  SummarySchema,
  validateFindings,
  validateReport,
} from '../../contracts/src/index.js';
import type { ToolBroker } from '../../tools/src/broker.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import {
  freezeRepository,
  inventory,
  syncRepository,
  validateRepository,
} from '../../tools/src/git.js';
import type { ModelStage } from './model-stage.js';
import { atomic, json, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';
/** Saved branch inventory and freshness warnings reused without resynchronizing on resume. */
interface FrozenInventory {
  inventory: Awaited<ReturnType<typeof inventory>>[];
  warnings: string[];
}
/** Persist a workflow position before its side effects begin. */
type Checkpoint = (stage: Stage) => Promise<void>;

/** Analyze frozen repository objects and publish only a structurally and evidentially validated report. */
export async function assessReport(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  broker: ToolBroker,
  stage: ModelStage,
  checkpoint: Checkpoint,
): Promise<void> {
  const baseline = run.baseline!;
  const frozen = await freezeInventory(context, run, signal, dir, broker, checkpoint);
  const discovery = await discoverSnapshots(stage, run, baseline, frozen, broker);
  broker.snapshots = discovery.snapshots;
  const findings = await stage(
    'assess',
    FindingsSchema,
    {
      baseline: baseline.product,
      discovery,
      previousReport: run.latestAtStart
        ? await context.getReport(run.projectId, run.latestAtStart)
        : null,
    },
    (v) => validateFindings(v, baseline.product, discovery.snapshots, broker.reads),
  );
  const summary = await stage(
    'summary',
    SummarySchema,
    { baseline: baseline.product, discovery, findings },
    (v) => SummarySchema.parse(v),
  );
  await checkpoint('report');
  await atomic(path.join(dir, 'reads.json'), broker.reads);
  const report = acceptedReport(run, baseline, discovery, findings, summary, frozen, broker.reads);
  await publishReport(context, run, signal, dir, report, baseline);
}
/** Restore frozen objects on resume, or synchronize and independently copy each repository once. */
async function freezeInventory(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  broker: ToolBroker,
  checkpoint: Checkpoint,
): Promise<FrozenInventory> {
  let frozen = await optionalJson<{
    inventory: Awaited<ReturnType<typeof inventory>>[];
    warnings: string[];
  }>(path.join(dir, 'inventory.json'));
  if (!frozen) {
    await checkpoint('sync');
    await validateProjectRepositories(run.project);
    const warnings: string[] = [...(run.project.discoveryWarnings ?? [])];
    for (const repo of run.project.repositories) {
      await validateRepository(repo);
      warnings.push(...(await syncRepository(repo, signal)));
    }
    const rows = await Promise.all(run.project.repositories.map((r) => inventory(r, signal)));
    for (const repo of run.project.repositories) {
      const row = rows.find((r) => r.repositoryId === repo.id)!;
      await freezeRepository(
        repo,
        [row.head, ...row.refs.map((r) => r.sha)],
        path.join(dir, 'snapshots', repo.id),
        signal,
      );
    }
    frozen = { inventory: rows, warnings };
    await atomic(path.join(dir, 'inventory.json'), frozen);
  }
  broker.project = {
    ...run.project,
    repositories: run.project.repositories.map((repo) => ({
      ...repo,
      path: path.join(dir, 'snapshots', repo.id),
    })),
  };
  broker.snapshots = frozen.inventory.flatMap((r) => {
    const refs = [...r.refs];
    if (!refs.some((s) => s.sha === r.head))
      refs.unshift({ repositoryId: r.repositoryId, branch: 'HEAD', sha: r.head });
    return refs.map((s) => ({ ...s, role: 'unknown' as const, reason: 'Frozen inventory' }));
  });

  return frozen;
}
/** Require selected commits to cover every repository’s baseline and belong to the frozen inventory. */
async function discoverSnapshots(
  stage: ModelStage,
  run: RunManifest,
  baseline: Baseline,
  frozen: FrozenInventory,
  broker: ToolBroker,
): Promise<Discovery> {
  const discovery = await stage(
    'discover',
    DiscoverySchema,
    {
      baseline: baseline.product,
      inventory: frozen.inventory,
      repositories: run.project.repositories.map((r) => ({ id: r.id, notes: r.notes })),
    },
    (v) => {
      const d = DiscoverySchema.parse(v);
      for (const repo of run.project.repositories) {
        const selected = d.snapshots.filter((s) => s.repositoryId === repo.id);
        if (
          !selected.length ||
          selected.length > 6 ||
          new Set(selected.map((s) => s.sha)).size !== selected.length
        )
          throw new Error('Select 1–6 distinct snapshots per repository.');
        const inv = frozen.inventory.find((i) => i.repositoryId === repo.id)!;
        const required = inv.refs.find((r) => r.branch === inv.defaultBranch)?.sha ?? inv.head;
        if (!selected.some((s) => s.sha === required))
          throw new Error('Include the default branch snapshot (or local HEAD when unavailable).');
      }
      for (const s of d.snapshots) broker.snapshot(s.repositoryId, s.sha);
      return d;
    },
  );

  return discovery;
}
/** Derive a report solely from validated stage outputs and the immutable reviewed baseline. */
function acceptedReport(
  run: RunManifest,
  baseline: Baseline,
  discovery: Discovery,
  findings: Findings,
  summary: { summary: string },
  frozen: FrozenInventory,
  reads: ReadReceipt[],
): Report {
  const report: Report = validateReport(
    {
      schemaVersion: '1.0',
      workflowVersion: '1',
      id: run.id,
      projectId: run.projectId,
      baselineId: baseline.id,
      generatedAt: new Date().toISOString(),
      runtime: {
        ...run.project.runtime,
        ...(run.runtimeModel ? { model: run.runtimeModel } : {}),
      },
      runtimeVersion: run.runtimeVersion ?? 'unknown',
      baseline: baseline.product,
      snapshots: discovery.snapshots,
      summary: summary.summary,
      ...findings,
      deviations: findings.assessments
        .filter((a) => a.deviation)
        .map((a) => ({
          requirementId: a.requirementId,
          explanation: a.explanation,
          evidence: a.evidence,
        })),
      warnings: [
        'Only committed snapshots are assessed. Uncommitted changes are excluded.',
        ...frozen.inventory.flatMap((i) => {
          const total = new Set([i.head, ...i.refs.map((r) => r.sha)]).size;
          const selected = discovery.snapshots.filter(
            (s) => s.repositoryId === i.repositoryId,
          ).length;
          return total > selected
            ? [
                `${i.repositoryId}: assessed ${selected} of ${total} available distinct commits (maximum six snapshots per repository). Other branches may contain unassessed behavior.`,
              ]
            : [];
        }),
        ...frozen.warnings,
        ...discovery.warnings,
        ...frozen.inventory.flatMap((i) => i.warnings),
      ],
      validation: 'structure-and-evidence-checked',
    },
    baseline,
    discovery.snapshots,
    reads,
  );

  return report;
}
/** Archive the result first, then update the latest pointer only if the starting baseline/report are still current. */
async function publishReport(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  report: Report,
  baseline: Baseline,
): Promise<void> {
  signal.throwIfAborted();
  await atomic(path.join(dir, 'report.json'), report);
  signal.throwIfAborted();
  const current = await json<Baseline>(
    path.join(context.store.project(run.projectId), 'baseline.json'),
  );
  const latest =
    (
      await optionalJson<{ id: string }>(
        path.join(context.store.project(run.projectId), 'latest.json'),
      )
    )?.id ?? null;
  if (current.id !== baseline.id || latest !== run.latestAtStart)
    throw new Error('Run is stale; its report was archived without changing the latest report.');
  run.status = 'completed';
  run.stage = 'complete';
  await atomic(path.join(dir, 'manifest.json'), run, signal);
  await atomic(
    path.join(context.store.project(run.projectId), 'latest.json'),
    { id: run.id },
    signal,
  );
  context.emit({ type: 'completed', runId: run.id, projectId: run.projectId, report });
}
