import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type ActivityKind,
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
import { deliveryTickets } from '../../reporting/src/tickets.js';
import type { ToolBroker } from '../../tools/src/broker.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import { freezeRepository, inventory, validateRepository } from '../../tools/src/git.js';
import { fetchMonitoredBranch } from '../../tools/src/remote-branches.js';
import { appendActivity } from './activity.js';
import { applyBlockers, blockedRequirements } from './blockers.js';
import { readCalls } from './calls.js';
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
  await checkpoint('discover');
  // The choice is saved so a resumed look and later report checks see the same snapshots.
  const saved = await optionalJson(path.join(dir, 'discover.json'));
  const discovery = saved ? DiscoverySchema.parse(saved) : chooseSnapshots(run, frozen);
  if (!saved) await atomic(path.join(dir, 'discover.json'), discovery, signal);
  for (const s of discovery.snapshots) broker.snapshot(s.repositoryId, s.sha);
  broker.snapshots = discovery.snapshots;
  const blockers = await blockedRequirements(context.store, run.projectId, baseline.product);
  const eligible = {
    ...baseline.product,
    requirements: baseline.product.requirements.filter((r) => !blockers.get(r.id)?.length),
  };
  delete eligible.deliveryPlan;
  const assessed: Findings = eligible.requirements.length
    ? await stage(
        'assess',
        FindingsSchema,
        {
          baseline: eligible,
          discovery,
          previousReport: run.latestAtStart
            ? await context.getReport(run.projectId, run.latestAtStart)
            : null,
        },
        (v) => validateFindings(v, eligible, discovery.snapshots, broker.reads),
      )
    : { assessments: [], risks: [], dependencies: [], unknowns: [] };
  const findings = await applyBlockers(context.store, run.projectId, baseline.product, assessed);
  await logFindings(context, run, findings);
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
/** How each code assessment reads in the action log: a confirmation, or a finding to act on. */
const codeStatus: Record<
  Findings['assessments'][number]['status'],
  { kind: ActivityKind; text: string }
> = {
  implemented: { kind: 'check', text: 'is built in the code' },
  partial: { kind: 'find', text: 'is only partly built in the code' },
  missing: { kind: 'find', text: 'has no code yet' },
  unknown: { kind: 'find', text: "can't be judged from the code alone" },
};

/** Log what the code assessment concluded for each requirement, with the model's explanation as the reason. */
async function logFindings(context: WorkflowContext, run: RunManifest, findings: Findings) {
  for (const a of findings.assessments)
    await appendActivity(context, run, {
      kind: codeStatus[a.status].kind,
      requirementId: a.requirementId,
      summary: `${a.requirementId} ${codeStatus[a.status].text}.`,
      reason: a.explanation,
    });
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
    const rows = await Promise.all(
      run.project.repositories.map(async (repo) => {
        await validateRepository(repo);
        const row = await inventory(repo, signal);
        try {
          row.remoteDefault = await fetchMonitoredBranch(repo, signal);
        } catch {
          signal.throwIfAborted();
          row.warnings.push(
            `${repo.id}: Remote delivery branch unavailable. Local work is progress only; merge and delivery completion are unverified.`,
          );
        }
        return row;
      }),
    );
    const warnings = [...(run.project.discoveryWarnings ?? [])];
    for (const repo of run.project.repositories) {
      const row = rows.find((r) => r.repositoryId === repo.id)!;
      await freezeRepository(
        repo,
        [
          row.head,
          ...row.refs.map((r) => r.sha),
          ...(row.worktrees ?? []),
          ...(row.remoteDefault ? [row.remoteDefault.sha] : []),
        ],
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
    if (r.remoteDefault)
      refs.push({
        repositoryId: r.repositoryId,
        branch: r.remoteDefault.branch,
        sha: r.remoteDefault.sha,
      });
    if (!refs.some((s) => s.sha === r.head))
      refs.unshift({ repositoryId: r.repositoryId, branch: 'HEAD', sha: r.head });
    for (const sha of r.worktrees ?? [])
      if (!refs.some((s) => s.sha === sha))
        refs.push({ repositoryId: r.repositoryId, branch: sha.slice(0, 12), sha });
    return refs.map((s) => ({ ...s, role: 'unknown' as const, reason: 'Frozen inventory' }));
  });

  return frozen;
}
/**
 * Select the freshly fetched selected remote for delivery. If unavailable, explicitly classify
 * local and worktree snapshots as progress-only evidence, never as a selected remote.
 */
export function chooseSnapshots(
  run: Pick<RunManifest, 'project'>,
  frozen: Pick<FrozenInventory, 'inventory'>,
): Discovery {
  const snapshots: Discovery['snapshots'] = [];
  for (const repo of run.project.repositories) {
    const inv = frozen.inventory.find((i) => i.repositoryId === repo.id)!;
    if (inv.remoteDefault) {
      snapshots.push({
        repositoryId: repo.id,
        sha: inv.remoteDefault.sha,
        branch: inv.remoteDefault.branch,
        role: 'integration',
        reason:
          'Freshly fetched from the selected remote branch. Local-only and other-branch work is excluded from delivery assessment.',
        source: 'remote-branch',
        checkedAt: inv.remoteDefault.checkedAt,
      });
      continue;
    }
    /** A local branch name for a commit, else a remote one, else HEAD for the checkout. */
    const branchOf = (sha: string) =>
      inv.refs.find((r) => r.sha === sha && !r.branch.includes('/'))?.branch ??
      inv.refs.find((r) => r.sha === sha)?.branch ??
      (sha === inv.head ? 'HEAD' : sha.slice(0, 12));
    const picks: { sha: string; role: 'default' | 'feature'; reason: string }[] = [
      {
        sha: inv.head,
        role: 'feature',
        reason: 'Checked out in your repository now.',
      },
      ...(inv.worktrees ?? []).map((sha) => ({
        sha,
        role: 'feature' as const,
        reason: 'Checked out in another worktree.',
      })),
    ];
    const unique = picks.filter((p, i) => picks.findIndex((o) => o.sha === p.sha) === i);
    snapshots.push(
      ...unique.slice(0, 6).map((p) => ({
        repositoryId: repo.id,
        sha: p.sha,
        branch: branchOf(p.sha),
        role: p.role,
        reason: p.reason,
        source: 'local' as const,
      })),
    );
  }
  return {
    snapshots,
    warnings: [
      'Delivery assessment uses freshly fetched selected remote branches. Where a remote is unavailable, local snapshots describe progress only and cannot establish merged or delivered work.',
    ],
  };
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
  const tickets = deliveryTickets(
    baseline.product,
    report,
    await readCalls(context.store, run.projectId),
  );
  await writeFile(
    path.join(dir, 'tickets.md'),
    tickets.map((t) => t.markdown).join('\n\n---\n\n'),
    { mode: 0o600 },
  );
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
