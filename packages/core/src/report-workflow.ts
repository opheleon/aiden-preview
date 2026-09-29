import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  assertUniqueRequirements,
  type Baseline,
  ProductSchema,
  type ReadReceipt,
  type RunManifest,
  type Stage,
} from '../../contracts/src/index.js';
import { ToolBroker } from '../../tools/src/broker.js';
import { serveTools } from '../../tools/src/mcp.js';
import { requestClarification } from './clarification.js';
import { executeEstimate } from './estimation-workflow.js';
import { createModelStage } from './model-stage.js';
import { assessReport } from './report-analysis.js';
import { atomic, optionalJson } from './storage.js';
import { executeVerification } from './verification-workflow.js';
import type { WorkflowContext } from './workflow-context.js';
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
    (question) => requestClarification(context, run, signal, dir, question),
    (message) =>
      context.emit({
        type: 'progress',
        runId: run.id,
        projectId: run.projectId,
        stage: run.stage,
        message,
      }),
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
      const previous = await optionalJson<Baseline>(
        path.join(context.store.project(run.projectId), 'baseline.json'),
      );
      const product = await stage(
        'understand',
        ProductSchema,
        { context: run.project.context, previous },
        (v) => {
          const p = ProductSchema.parse(v);
          assertUniqueRequirements(p);
          return p;
        },
      );
      run.stage = 'review';
      run.status = 'review';
      await atomic(path.join(dir, 'manifest.json'), run);
      context.emit({ type: 'review', runId: run.id, projectId: run.projectId, product });
      return;
    }
    await assessReport(context, run, signal, dir, broker, stage, checkpoint);
  } finally {
    await tools.close();
  }
}
