import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type Baseline,
  type LookReason,
  type ReadReceipt,
  type RunManifest,
  type Stage,
} from '../../contracts/src/index.js';
import { deliveryTickets } from '../../reporting/src/tickets.js';
import { ToolBroker } from '../../tools/src/broker.js';
import { serveTools } from '../../tools/src/mcp.js';
import { appendActivity, counted, recordStep } from './activity.js';
import { commitBaseline } from './baseline.js';
import { answeredDecisions, openDecisions, readCalls, replaceOpenDecisions } from './calls.js';
import { requestClarification } from './clarification.js';
import { executeEstimate } from './estimation-workflow.js';
import { createModelStage, type ModelStage } from './model-stage.js';
import { assessReport } from './report-analysis.js';
import { atomic, hash, optionalJson } from './storage.js';
import {
  describeRepository,
  parseUnderstanding,
  productFromUnderstanding,
  type StoredUnderstanding,
  UnderstandingSchema,
} from './understanding.js';
import { executeVerification } from './verification-workflow.js';
import type { WorkflowContext } from './workflow-context.js';
/** What each kind of run sets out to do, as the first line of its action log. */
/** What each stage is doing, as a step in the run's history. */
const stageSteps: Partial<Record<Stage, string>> = {
  understand: 'Writing the requirements from your goal',
  sync: 'Syncing your repositories',
  discover: 'Choosing which commits to read',
  assess: 'Checking the code against the requirements',
  summary: 'Summarizing what it found',
  report: 'Saving the brief',
};

const lookSummary: Record<RunManifest['kind'], string> = {
  prepare: 'Reading your goal to write the requirements.',
  report: 'Checking the code against the requirements.',
  estimate: 'Estimating the remaining work.',
  verify: 'Checking the running app.',
};

/** Why Aiden started the run, in the words the action log uses. */
const lookReason: Record<LookReason, string> = {
  you: 'You asked Aiden to run a check.',
  commit: 'New commits landed in the project.',
  ticket: 'A ticket changed status in the tracker.',
  morning: 'The morning look.',
  intent: 'The scope changed.',
  answer: 'You made a call.',
};

/**
 * Write what done means with edge cases and calls. An auto-accepted run commits the baseline
 * itself (it already holds the project lock); otherwise the run stops for review.
 */
async function understandIntent(
  context: WorkflowContext,
  run: RunManifest,
  dir: string,
  stage: ModelStage,
): Promise<void> {
  const previous = await optionalJson<Baseline>(
    path.join(context.store.project(run.projectId), 'baseline.json'),
  );
  const openCalls = await openDecisions(context.store, run.projectId);
  const repositoryIds = run.project.repositories.map((r) => r.id);
  const checkpoint = await optionalJson<unknown>(path.join(dir, 'understand.json'));
  // Keep the input revision with the checkpoint. A late answer or restart must not make an old
  // model response appear to have incorporated a decision it never received.
  const revisionFile = path.join(dir, 'understand-decisions.json');
  const decisionsHash =
    checkpoint !== null
      ? ((await optionalJson<string>(revisionFile)) ?? '')
      : hash(await answeredDecisions(context.store, run.projectId));
  if (checkpoint === null) await atomic(revisionFile, decisionsHash);
  const understanding = await stage<StoredUnderstanding>(
    'understand',
    UnderstandingSchema,
    {
      context: run.project.context,
      previous,
      openCalls,
      repositories: await Promise.all(run.project.repositories.map(describeRepository)),
    },
    (v) => parseUnderstanding(v, previous, repositoryIds, checkpoint !== null),
  );
  const { product, calls, settledCalls } = productFromUnderstanding(understanding, repositoryIds);
  // Only a new answer or changed intent can settle a blocker; otherwise omission keeps it open.
  const canSettle =
    !previous ||
    previous.decisionsHash !== decisionsHash ||
    previous.contextHash !== hash(run.project.context);
  const { created, settled } = await replaceOpenDecisions(
    context.store,
    run.projectId,
    calls,
    run.id,
    canSettle ? settledCalls : [],
  );
  const tickets = deliveryTickets(
    product,
    undefined,
    await readCalls(context.store, run.projectId),
  );
  await writeFile(
    path.join(dir, 'tickets.md'),
    tickets.map((t) => t.markdown).join('\n\n---\n\n'),
    { mode: 0o600 },
  );
  const edgeCases = product.requirements.reduce((n, r) => n + (r.edgeCases?.length ?? 0), 0);
  await appendActivity(context, run, {
    kind: 'decide',
    summary: `Wrote ${counted(product.requirements.length, 'requirement')} and ${counted(edgeCases, 'edge case')}.`,
    reason: product.overview,
  });
  for (const call of settled)
    await appendActivity(context, run, {
      kind: 'decide',
      ...(call.requirementId ? { requirementId: call.requirementId } : {}),
      summary: `Closed a question your answers already settle: ${call.question}`,
      reason: 'The rewritten scope covers this decision, so it no longer needs an answer.',
    });
  for (const call of created)
    await appendActivity(context, run, {
      kind: 'ask',
      ...(call.requirementId ? { requirementId: call.requirementId } : {}),
      ...(call.edgeCaseId ? { edgeCaseId: call.edgeCaseId } : {}),
      summary: `Asked you: ${call.question}`,
      reason:
        call.blocking === false
          ? `Reversible assumption: ${call.assumption}`
          : `Blocked: ${call.question}. ${call.assumption}`,
    });
  if (run.autoAccept) {
    await commitBaseline(context.store, run.projectId, product, run.project.context, decisionsHash);
    run.stage = 'complete';
    run.status = 'completed';
    await atomic(path.join(dir, 'manifest.json'), run);
    context.emit({ type: 'completed', runId: run.id, projectId: run.projectId, product });
    return;
  }
  run.stage = 'review';
  run.status = 'review';
  await atomic(path.join(dir, 'manifest.json'), run);
  context.emit({ type: 'review', runId: run.id, projectId: run.projectId, product });
}

/** Establish one run’s tool boundary, route preparation/analysis/estimation/verification, and always close the tool server. */
export async function execute(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
): Promise<void> {
  const dir = context.store.run(run.projectId, run.id);
  const artifacts = path.join(dir, 'artifacts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const workspace = path.join(dir, 'runtime');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await appendActivity(context, run, {
    kind: 'look',
    summary: lookSummary[run.kind],
    ...(run.reason ? { reason: lookReason[run.reason] } : {}),
  });
  if (run.kind === 'estimate') {
    await executeEstimate(context, run, signal, dir, artifacts, workspace);
    return;
  }
  if (run.kind === 'verify') {
    await executeVerification(context, run, signal, dir, workspace);
    return;
  }
  /** Persist stage progression before provider or repository work starts. */
  const checkpoint = async (stage: Stage): Promise<void> => {
    signal.throwIfAborted();
    run.stage = stage;
    run.status = 'running';
    await atomic(path.join(dir, 'manifest.json'), run);
    await recordStep(context, run, stageSteps[stage] ?? `Started ${stage}`);
    context.emit({
      type: 'progress',
      runId: run.id,
      projectId: run.projectId,
      stage,
      message: `${stage.charAt(0).toUpperCase() + stage.slice(1)}…`,
    });
  };
  const broker = new ToolBroker(
    run.project,
    artifacts,
    path.join(dir, 'reads.json'),
    (request) => requestClarification(context, run, signal, request),
    (message) => {
      context.emit({
        type: 'progress',
        runId: run.id,
        projectId: run.projectId,
        stage: run.stage,
        message,
      });
      void recordStep(context, run, message);
    },
    (connectionId, tool, args, externalSignal) =>
      context.integrations.call(connectionId, tool, args, externalSignal),
  );
  broker.signal = signal;
  broker.reads = (await optionalJson<ReadReceipt[]>(path.join(dir, 'reads.json'))) ?? [];
  const tools = await serveTools(broker);
  const stage = createModelStage({
    context,
    run,
    signal,
    dir,
    workspace,
    tools,
    includeAnswers: true,
    onStage: async (name, validate) => {
      await checkpoint(name as Stage);
      broker.validateArtifact = validate;
    },
  });
  try {
    if (run.kind === 'prepare') {
      await understandIntent(context, run, dir, stage);
      return;
    }
    await assessReport(context, run, signal, dir, broker, stage, checkpoint);
  } finally {
    await tools.close();
  }
}
