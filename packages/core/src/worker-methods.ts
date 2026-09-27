import { z } from 'zod/v3';

import type { WorkerMethod } from '../../contracts/src/api.js';
import {
  EstimateOverridesSchema,
  id,
  McpAuthSchema,
  ProductSchema,
  ProjectSchema,
  ProjectSourcesSchema,
  RuntimeSchema,
} from '../../contracts/src/index.js';
import { Runtimes } from '../../runtimes/src/index.js';
import { discoverRepositories } from '../../tools/src/discovery.js';
import { Engine } from './engine.js';
/** Provider controls separate authentication/model discovery from run execution. */
export type RuntimeControls = Pick<Runtimes, 'diagnostics' | 'models' | 'setKey' | 'loginCodex'>;
/** Validate unknown worker inputs before dispatching a typed operation. */
function operation<T>(
  schema: z.ZodType<T>,
  call: (params: T) => unknown,
): (params: unknown) => unknown {
  return (params: unknown) => call(schema.parse(params));
}
const project = z.object({ projectId: id }).strict();
const run = project.extend({ runId: id });

/** Construct the existing worker API around injected engine and provider services. */
export function createMethods(
  engine: Engine,
  runtimes: RuntimeControls,
): Record<WorkerMethod, (params: unknown) => unknown> {
  return {
    discoverRepositories: operation(z.object({ rootPath: z.string().min(1) }).strict(), (p) =>
      discoverRepositories(p.rootPath),
    ),
    projects: operation(z.object({}).strict(), () => engine.projects()),
    state: operation(project, (p) => engine.state(p.projectId)),
    prepare: operation(z.object({ project: ProjectSchema }).strict(), (p) =>
      engine.prepare(p.project),
    ),
    approve: operation(run.extend({ product: ProductSchema }).strict(), (p) =>
      engine.approve(p.projectId, p.runId, p.product),
    ),
    report: operation(project, (p) => engine.report(p.projectId)),
    resume: operation(run, (p) => engine.resume(p.projectId, p.runId)),
    cancel: operation(z.object({ runId: id }).strict(), (p) => engine.cancel(p.runId)),
    waitForRun: operation(z.object({ runId: id }).strict(), async (p) => {
      await engine.wait(p.runId);
      return null;
    }),
    answer: operation(
      z.object({ runId: id, questionId: id, answer: z.string().min(1).max(20000) }).strict(),
      (p) => engine.answer(p.runId, p.questionId, p.answer),
    ),
    candidate: operation(run, (p) => engine.candidate(p.projectId, p.runId)),
    result: operation(project.extend({ runId: id.optional() }), (p) =>
      engine.getReport(p.projectId, p.runId),
    ),
    export: operation(
      run.extend({
        format: z.enum(['json', 'markdown']),
        includeEstimates: z.boolean().optional(),
      }),
      (p) => engine.export(p.projectId, p.runId, p.format, p.includeEstimates),
    ),
    evidence: operation(
      run.extend({
        index: z.number().int().nonnegative(),
        evidenceIndex: z.number().int().nonnegative(),
      }),
      (p) => engine.evidence(p.projectId, p.runId, p.index, p.evidenceIndex),
    ),
    ...runtimeMethods(engine, runtimes),
    ...integrationMethods(engine),
    updateSources: operation(project.extend({ sources: ProjectSourcesSchema }), (p) =>
      engine.updateSources(p.projectId, p.sources),
    ),
    estimate: operation(
      project.extend({ reportId: id.optional(), refreshHistory: z.boolean().optional() }),
      (p) => engine.estimate(p.projectId, p.reportId, p.refreshHistory),
    ),
    estimation: operation(project, (p) => engine.getEstimate(p.projectId)),
    estimateOverrides: operation(project.extend({ overrides: EstimateOverridesSchema }), (p) =>
      engine.applyEstimateOverrides(p.projectId, p.overrides),
    ),
  };
}

/** Keep credential and model controls separate from run execution while validating their inputs. */
function runtimeMethods(engine: Engine, runtimes: RuntimeControls) {
  return {
    diagnostics: operation(z.object({}).strict(), () => runtimes.diagnostics()),
    models: operation(z.object({ runtime: RuntimeSchema }).strict(), (p) =>
      runtimes.models(p.runtime),
    ),
    setKey: operation(
      z.object({ provider: z.enum(['codex', 'claude']), key: z.string().min(1) }).strict(),
      (p) => {
        runtimes.setKey(p.provider, p.key);
        return { saved: 'memory-only' };
      },
    ),
    login: operation(z.object({ provider: z.literal('codex') }).strict(), () =>
      runtimes.loginCodex(),
    ),
    updateRuntime: operation(project.extend({ runtime: RuntimeSchema }), (p) =>
      engine.updateRuntime(p.projectId, p.runtime),
    ),
  };
}

/** Expose only validated connection-management and approved hosted-tool operations. */
function integrationMethods(engine: Engine) {
  return {
    integrations: operation(z.object({}).strict(), () => engine.integrations.list()),
    integrationAdd: operation(
      z
        .object({
          name: z.string().min(1).max(100),
          provider: z.enum(['linear', 'custom']),
          url: z.string().url(),
          auth: McpAuthSchema,
          bearer: z.string().min(1).optional(),
          clientId: z.string().min(1).optional(),
          sessionOnly: z.boolean().optional(),
        })
        .strict(),
      (p) =>
        engine.integrations.add({
          name: p.name,
          provider: p.provider,
          url: p.url,
          auth: p.auth,
          ...(p.bearer === undefined ? {} : { bearer: p.bearer }),
          ...(p.clientId === undefined ? {} : { clientId: p.clientId }),
          ...(p.sessionOnly === undefined ? {} : { sessionOnly: p.sessionOnly }),
        }),
    ),
    integrationConnect: operation(z.object({ connectionId: id }).strict(), (p) =>
      engine.integrations.connect(p.connectionId),
    ),
    integrationTools: operation(z.object({ connectionId: id }).strict(), (p) =>
      engine.integrations.refreshTools(p.connectionId),
    ),
    integrationApprove: operation(
      z.object({ connectionId: id, tools: z.array(z.string()), fingerprint: z.string() }).strict(),
      (p) => engine.integrations.approve(p.connectionId, p.tools, p.fingerprint),
    ),
    integrationCall: operation(
      z
        .object({
          connectionId: id,
          tool: z.string().min(1),
          arguments: z.record(z.string(), z.unknown()),
        })
        .strict(),
      (p) => engine.integrations.call(p.connectionId, p.tool, p.arguments),
    ),
    integrationDisconnect: operation(z.object({ connectionId: id }).strict(), (p) =>
      engine.integrations.disconnect(p.connectionId),
    ),
    integrationRemove: operation(z.object({ connectionId: id }).strict(), (p) =>
      engine.integrations.remove(p.connectionId),
    ),
  };
}
