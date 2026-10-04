import { z } from 'zod/v3';

import type { WorkerMethod } from '../../contracts/src/api.js';
import {
  ApiVerificationSchema,
  BetaSettingsSchema,
  EstimateOverridesSchema,
  id,
  McpAuthSchema,
  ProductSchema,
  ProjectSchema,
  ProjectSourcesSchema,
  RuntimeSchema,
} from '../../contracts/src/index.js';
import { TicketSettingsSchema, TicketToolsSchema } from '../../contracts/src/tickets.js';
import { Runtimes } from '../../runtimes/src/index.js';
import { discoverRepositories } from '../../tools/src/discovery.js';
import { readActivity, readRunLog } from './activity.js';
import { askWhy, explainEntry, readChat } from './ask-why.js';
import { betaSettings, reconcileDelivery, saveBetaSettings } from './beta-delivery.js';
import { readCalls, settleAppUrlCalls } from './calls.js';
import { cancelCoding, codingJobs, startCodingJob } from './coding-jobs.js';
import { confirmAction, readConfirmations } from './confirmations.js';
import { Engine } from './engine.js';
import { linearTeams, publishLinearTickets } from './linear-projects.js';
import {
  answerAndLook,
  editIntent,
  followWithBrowserCheck,
  prepareAndLook,
  repositoryHeads,
  startLook,
} from './look.js';
import { initializeMonitoring, monitoringBranches, saveMonitoredBranch } from './monitoring.js';
import { readTicketState, saveTicketSettings, ticketCapabilities } from './ticket-storage.js';
import { syncTickets } from './ticket-sync.js';
import { readAppUrl, saveVerificationSettings } from './verification-settings.js';
import { readVerification } from './verification-workflow.js';
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
    state: operation(project, async (p) => {
      const saved = await engine.state(p.projectId);
      const activeRunIds = saved.runs.filter((r) => engine.isActive(r.id)).map((r) => r.id);
      return { ...saved, activeRunIds };
    }),
    prepare: operation(
      z.object({ project: ProjectSchema, autoAccept: z.boolean().optional() }).strict(),
      (p) =>
        p.autoAccept ? prepareAndLook(engine, p.project, 'intent') : engine.prepare(p.project),
    ),
    approve: operation(run.extend({ product: ProductSchema }).strict(), (p) =>
      engine.approve(p.projectId, p.runId, p.product),
    ),
    report: operation(project.extend({ browserCheck: z.boolean().optional() }), async (p) => {
      const started = await engine.report(p.projectId);
      if (p.browserCheck) followWithBrowserCheck(engine, p.projectId, started.runId);
      return started;
    }),
    resume: operation(run, (p) => engine.resume(p.projectId, p.runId)),
    cancel: operation(z.object({ runId: id }).strict(), (p) => engine.cancel(p.runId)),
    waitForRun: operation(z.object({ runId: id }).strict(), async (p) => {
      await engine.wait(p.runId);
      return null;
    }),
    ...functionMethods(engine),
    codingJobs: operation(project, (p) => codingJobs(engine, p.projectId)),
    startCoding: operation(
      project.extend({ repositoryId: id, instruction: z.string().trim().min(1).max(10000) }),
      (p) =>
        startCodingJob(engine, p.projectId, p.repositoryId, p.instruction, () =>
          reconcileDelivery(engine, p.projectId),
        ),
    ),
    cancelCoding: operation(project.extend({ jobId: z.string().uuid() }), async (p) => {
      if (!(await codingJobs(engine, p.projectId)).some((j) => j.id === p.jobId))
        throw new Error('Unknown project job.');
      await cancelCoding(engine, p.jobId);
      return null;
    }),
    reconcileDelivery: operation(project, (p) => reconcileDelivery(engine, p.projectId)),
    betaSettings: operation(project, (p) => betaSettings(engine, p.projectId)),
    updateBetaSettings: operation(project.extend({ settings: BetaSettingsSchema }), (p) =>
      saveBetaSettings(engine, p.projectId, p.settings),
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
    verify: operation(project.extend({ url: z.string().min(1).max(2000).optional() }), (p) =>
      engine.verify(p.projectId, p.url),
    ),
    verificationSettings: operation(project, (p) => readAppUrl(engine, p.projectId)),
    updateVerificationSettings: operation(
      project.extend({
        url: z.string().min(1).max(2000).nullable().optional(),
        api: ApiVerificationSchema.nullable().optional(),
      }),
      (p) => saveVerificationSettings(engine, p.projectId, p),
    ),
    verification: operation(project.extend({ runId: id.optional() }), (p) =>
      readVerification(engine, p.projectId, p.runId),
    ),
  };
}

/** The automated function: looking, the action log, calls, and intent changes. */
function functionMethods(engine: Engine) {
  return {
    ...ticketMethods(engine),
    monitoring: operation(project, (p) =>
      engine.isBusy(p.projectId)
        ? engine.state(p.projectId).then((s) => s.project)
        : initializeMonitoring(engine.store, p.projectId),
    ),
    remoteBranches: operation(project.extend({ repositoryId: id }).strict(), (p) =>
      monitoringBranches(engine.store, p.projectId, p.repositoryId),
    ),
    updateMonitoredBranch: operation(
      project
        .extend({
          repositoryId: id,
          monitoredBranch: ProjectSchema.shape.repositories.element.shape.monitoredBranch.unwrap(),
        })
        .strict(),
      (p) => saveMonitoredBranch(engine.store, p.projectId, p.repositoryId, p.monitoredBranch),
    ),
    look: operation(
      project.extend({ reason: z.enum(['commit', 'morning', 'ticket']).optional() }),
      (p) => startLook(engine, p.projectId, p.reason ?? 'you'),
    ),
    activity: operation(project, (p) => readActivity(engine.store, p.projectId)),
    calls: operation(project, async (p) => {
      await settleAppUrlCalls(
        engine.store,
        p.projectId,
        'Local checks belong to the coding agent. Configure beta verification in Settings.',
      );
      return readCalls(engine.store, p.projectId);
    }),
    answerCall: operation(
      project.extend({ callId: id, answer: z.string().trim().min(1).max(2000) }).strict(),
      (p) => answerAndLook(engine, p.projectId, p.callId, p.answer),
    ),
    editIntent: operation(
      z.union([
        project.extend({ context: z.string().trim().min(1).max(20000) }).strict(),
        project.extend({ product: ProductSchema }).strict(),
      ]),
      (p) =>
        editIntent(
          engine,
          p.projectId,
          'product' in p ? { product: p.product } : { context: p.context },
        ),
    ),
    heads: operation(project, (p) => repositoryHeads(engine, p.projectId)),
    runLog: operation(run, (p) => readRunLog(engine.store, p.projectId, p.runId)),
    confirmations: operation(project, (p) => readConfirmations(engine.store, p.projectId)),
    confirmAction: operation(
      project.extend({ key: z.string().min(1).max(40), reportId: id }).strict(),
      (p) => confirmAction(engine.store, p.projectId, p.key, p.reportId),
    ),
    chat: operation(run, (p) => readChat(engine.store, p.projectId, p.runId)),
    explain: operation(
      run.extend({ at: z.string().datetime(), summary: z.string().min(1).max(300) }).strict(),
      (p) => explainEntry(engine, p.projectId, p.runId, { at: p.at, summary: p.summary }),
    ),
    askWhy: operation(run.extend({ question: z.string().trim().min(1).max(1000) }).strict(), (p) =>
      askWhy(engine, p.projectId, p.runId, p.question),
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
    integrationPreset: operation(z.object({ provider: z.enum(['linear', 'jira']) }).strict(), (p) =>
      engine.integrations.preset(p.provider),
    ),
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

/** Expose only project-scoped ticket authorization and deterministic reconciliation. */
function ticketMethods(engine: Engine) {
  return {
    linearTeams: operation(z.object({ connectionId: id }).strict(), (p) =>
      linearTeams(engine, p.connectionId),
    ),
    publishLinearTickets: operation(
      project
        .extend({
          connectionId: id,
          teamId: z.string().trim().min(1).max(200),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          tools: TicketToolsSchema,
        })
        .strict(),
      (p) => publishLinearTickets(engine, p.projectId, p),
    ),
    ticketState: operation(project, (p) => readTicketState(engine.store, p.projectId)),
    ticketCapabilities: operation(
      z.object({ connectionId: id, provider: z.enum(['linear', 'jira']) }).strict(),
      (p) => ticketCapabilities(engine, p.connectionId, p.provider),
    ),
    saveTicketSettings: operation(project.extend({ settings: TicketSettingsSchema }), async (p) => {
      await saveTicketSettings(engine, p.projectId, p.settings);
      return syncTickets(engine, p.projectId);
    }),
    syncTickets: operation(project, (p) => syncTickets(engine, p.projectId)),
  };
}
