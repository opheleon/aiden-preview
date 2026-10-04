import path from 'node:path';

import {
  type Baseline,
  type EstimateOverrides,
  type EstimationSnapshot,
  EstimationSnapshotSchema,
  type HistoryIssue,
  type Report,
  type RequirementEstimate,
  type RunManifest,
} from '../../contracts/src/index.js';
import { buildForecast, defaultOverrides } from '../../estimation/src/index.js';
import { ToolBroker } from '../../tools/src/broker.js';
import { serveTools } from '../../tools/src/mcp.js';
import { requireDefinedScope } from './blockers.js';
import { collectEstimationHistory, type EstimationHistory } from './estimation-history.js';
import {
  buildRequirementEstimates,
  historicalEstimates,
  originalEstimates,
  remainingEstimates,
} from './estimation-stages.js';
import { createModelStage } from './model-stage.js';
import { atomic, hash, json, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';
/** Run independently accepted estimation stages inside an authenticated, cancellation-aware tool boundary. */
export async function executeEstimate(
  context: WorkflowContext,
  run: RunManifest & { estimateReportId?: string; refreshHistory?: boolean },
  signal: AbortSignal,
  dir: string,
  artifacts: string,
  workspace: string,
): Promise<void> {
  const baseline = run.baseline!;
  await requireDefinedScope(context.store, run.projectId, baseline.product);
  const report = run.estimateReportId
    ? await context.getReport(run.projectId, run.estimateReportId)
    : null;
  const broker = new ToolBroker(
    run.project,
    artifacts,
    path.join(dir, 'reads.json'),
    () => Promise.reject(new Error('Estimation does not request interactive clarification.')),
    (message) =>
      context.emit({
        type: 'progress',
        runId: run.id,
        projectId: run.projectId,
        stage: 'estimate',
        message,
      }),
    (connectionId, tool, args, externalSignal) =>
      context.integrations.call(connectionId, tool, args, externalSignal),
  );
  broker.signal = signal;
  const tools = await serveTools(broker);
  const modelStage = createModelStage({ context, run, signal, dir, workspace, tools });
  try {
    context.emit({
      type: 'progress',
      runId: run.id,
      projectId: run.projectId,
      stage: 'estimate',
      message: 'Classifying reviewed requirements…',
    });
    const complexity = await originalEstimates(modelStage, baseline);
    const collected = await collectEstimationHistory(context, run, signal, dir);
    const history = await historicalEstimates(modelStage, collected.rows);
    const remaining = await remainingEstimates(modelStage, baseline, report, context, run, history);
    const overrides =
      (await optionalJson<EstimateOverrides>(
        path.join(context.store.project(run.projectId), 'estimate-overrides.json'),
      )) ?? defaultOverrides();
    const requirementEstimates = buildRequirementEstimates(
      complexity,
      remaining,
      history,
      overrides,
    );
    const snapshot = estimateSnapshot(
      run,
      baseline,
      report,
      collected,
      history,
      requirementEstimates,
      overrides,
    );
    await publishEstimate(context, run, signal, dir, snapshot, baseline, report);
  } finally {
    await tools.close();
  }
}

/** Retain rubric, provenance, source completeness, and explicit overrides in one versioned estimate. */
function estimateSnapshot(
  run: RunManifest,
  baseline: Baseline,
  report: Report | null,
  collected: EstimationHistory,
  history: HistoryIssue[],
  requirementEstimates: RequirementEstimate[],
  overrides: EstimateOverrides,
): EstimationSnapshot {
  const snapshot: EstimationSnapshot = EstimationSnapshotSchema.parse({
    schemaVersion: '1.0',
    estimatorVersion: '2',
    id: run.id,
    projectId: run.projectId,
    baselineId: baseline.id,
    reportId: report?.id ?? null,
    runtime: {
      ...run.project.runtime,
      ...(run.runtimeModel ? { model: run.runtimeModel } : {}),
    },
    runtimeVersion: run.runtimeVersion ?? 'unknown',
    sourceSelectionHash: hash(run.project.sources ?? { contextConnectionIds: [], history: null }),
    generatedAt: new Date().toISOString(),
    historyCollectedAt: collected.historyCollectedAt,
    historyComplete: collected.historyComplete,
    historyTruncated: collected.historyTruncated,
    historyLimitations: [...new Set(collected.historyLimitations)],
    requirements: requirementEstimates,
    history,
    receipts: collected.receipts,
    forecast: buildForecast({
      requirements: requirementEstimates,
      report,
      history,
      historyComplete: collected.historyComplete,
      overrides,
      referenceDate: new Date().toISOString().slice(0, 10),
    }),
    validation: 'structure-and-sources-checked',
  });

  return snapshot;
}

/** Publish a new estimate only if its baseline and accepted report are still current at commit time. */
async function publishEstimate(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  snapshot: EstimationSnapshot,
  baseline: Baseline,
  report: Report | null,
): Promise<void> {
  signal.throwIfAborted();
  await requireDefinedScope(context.store, run.projectId, baseline.product);
  const current = await json<Baseline>(
    path.join(context.store.project(run.projectId), 'baseline.json'),
  );
  const latestReport = await optionalJson<{ id: string }>(
    path.join(context.store.project(run.projectId), 'latest.json'),
  );
  if (current.id !== baseline.id || (report && latestReport?.id !== report.id))
    throw new Error(
      'Estimation became stale and was archived without replacing the accepted estimate.',
    );
  await atomic(
    path.join(context.store.project(run.projectId), 'estimates', `${snapshot.id}.json`),
    snapshot,
    signal,
  );
  run.status = 'completed';
  run.stage = 'complete';
  await atomic(path.join(dir, 'manifest.json'), run, signal);
  await atomic(
    path.join(context.store.project(run.projectId), 'latest-estimate.json'),
    { id: snapshot.id },
    signal,
  );
  context.emit({
    type: 'completed',
    runId: run.id,
    projectId: run.projectId,
    estimation: snapshot,
  });
}
