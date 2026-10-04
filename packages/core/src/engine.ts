import path from 'node:path';

import {
  type Baseline,
  type EstimateOverrides,
  type EstimationSnapshot,
  type Evidence,
  type LookReason,
  type Product,
  type Project,
  ProjectSchema,
  type ProjectSources,
  type Report,
  type RunEvent,
  type RunManifest,
} from '../../contracts/src/index.js';
import { ConnectionManager } from '../../integrations/src/index.js';
import { type AgentRuntime, Runtimes } from '../../runtimes/src/index.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import type { DiscoverOptions } from '../../verification/src/index.js';
import { commitBaseline } from './baseline.js';
import { closeCoding } from './coding-jobs.js';
import {
  exportReport,
  listProjects,
  readAcceptedReport,
  readCurrentEstimate,
  readEvidence,
  readProject,
  runHistory,
} from './engine-queries.js';
import { applyOverrides } from './estimate-overrides.js';
import { initializeMonitoring } from './monitoring.js';
import {
  acquireProjectLock,
  type ActiveRun,
  createRun,
  launchRun,
  type RunExtras,
} from './run-lifecycle.js';
import { atomic, hash, json, optionalJson, Store } from './storage.js';
import { savedProduct } from './understanding.js';
import { resolveVerifyUrl } from './verification-settings.js';
import type { WorkflowContext } from './workflow-context.js';

/** Own project locks and explicit run lifecycles while keeping accepted artifacts separate from in-flight work. */
export class Engine {
  private active = new Map<string, ActiveRun>();
  /** How Aiden probes localhost for a running app; tests replace `fetch` so no socket opens. */
  discover: DiscoverOptions = {};
  /** Bind storage, provider, and integration dependencies without starting provider execution. */
  constructor(
    public store = new Store(),
    public runtime: AgentRuntime = new Runtimes(path.join(store.root, 'providers')),
    public emit: (event: RunEvent) => void = () => {},
    public integrations = new ConnectionManager(store.root),
  ) {}
  /** List saved project metadata; a new home returns no projects, while corruption remains an error. */
  async projects(): Promise<Project[]> {
    return listProjects(this.store);
  }
  /** Load the current project, reviewed baseline, and run history without resuming interrupted work. */
  async state(
    projectId: string,
  ): Promise<{ project: Project | null; baseline: Baseline | null; runs: RunManifest[] }> {
    const folder = this.store.project(projectId);
    return {
      project: await readProject(this.store, projectId),
      baseline: await optionalJson<Baseline>(path.join(folder, 'baseline.json')),
      runs: await this.history(projectId),
    };
  }
  /** List persisted run manifests newest first, excluding directories without a manifest. */
  async history(projectId: string): Promise<RunManifest[]> {
    return runHistory(this.store, projectId);
  }
  /** Acquire the per-project filesystem lock shared by every run and project mutation. */
  private lock(projectId: string): Promise<() => Promise<void>> {
    return acquireProjectLock(this.store, projectId);
  }
  /**
   * The lock a run of this kind takes. Browser checks only read the project and write their own
   * results, so they take a separate lock and run alongside a code check.
   */
  private lockFor(projectId: string, kind: RunManifest['kind']): Promise<() => Promise<void>> {
    return kind === 'verify'
      ? acquireProjectLock(this.store, projectId, 'browser')
      : this.lock(projectId);
  }
  /**
   * Validate repository boundaries and begin writing what done means under the project lock. With
   * `autoAccept`, the run commits its result as the new baseline instead of stopping for review.
   */
  async prepare(
    input: Project,
    options: Pick<RunExtras, 'autoAccept' | 'reason'> = {},
  ): Promise<{ runId: string }> {
    const project = await validateProjectRepositories(ProjectSchema.parse(input));
    return this.start(project, 'prepare', undefined, options);
  }
  /** Start analysis only when the approved context still matches the saved project intent. */
  async report(projectId: string, reason?: LookReason): Promise<{ runId: string }> {
    const project = await initializeMonitoring(this.store, projectId);
    const baseline = await json<Baseline>(
      path.join(this.store.project(projectId), 'baseline.json'),
    );
    if (baseline.contextHash !== hash(project.context))
      throw new Error('Review the changed project context before running another report.');
    return this.start(project, 'report', baseline, reason ? { reason } : {});
  }
  /** Persist an explicitly chosen provider configuration only while the project is idle. */
  async updateRuntime(projectId: string, config: Project['runtime']): Promise<void> {
    const release = await this.lock(projectId);
    try {
      const p = ProjectSchema.parse(
        await json(path.join(this.store.project(projectId), 'project.json')),
      );
      p.runtime = ProjectSchema.shape.runtime.parse(config);
      await atomic(path.join(this.store.project(projectId), 'project.json'), p);
    } finally {
      await release();
    }
  }
  /** Update project-scoped source consent; changing history clears comparisons and historical overrides. */
  async updateSources(projectId: string, sources: ProjectSources): Promise<void> {
    const release = await this.lock(projectId);
    try {
      const p = ProjectSchema.parse(
        await json(path.join(this.store.project(projectId), 'project.json')),
      );
      const historyChanged = hash(p.sources?.history ?? null) !== hash(sources.history);
      p.sources = sources;
      await atomic(path.join(this.store.project(projectId), 'project.json'), p);
      if (historyChanged) {
        const existing = await optionalJson<EstimateOverrides>(
          path.join(this.store.project(projectId), 'estimate-overrides.json'),
        );
        if (existing)
          await atomic(path.join(this.store.project(projectId), 'estimate-overrides.json'), {
            ...existing,
            comparisons: {},
            historicalPoints: {},
          });
      }
    } finally {
      await release();
    }
  }
  /** Begin an independent estimate tied to the reviewed baseline and optional accepted report. */
  async estimate(
    projectId: string,
    reportId?: string,
    refreshHistory = false,
  ): Promise<{ runId: string }> {
    const project = ProjectSchema.parse(
      await json(path.join(this.store.project(projectId), 'project.json')),
    );
    const baseline = await json<Baseline>(
      path.join(this.store.project(projectId), 'baseline.json'),
    );
    let resolvedReportId = reportId;
    if (!resolvedReportId) {
      resolvedReportId = (
        await optionalJson<{ id: string }>(path.join(this.store.project(projectId), 'latest.json'))
      )?.id;
    }
    if (resolvedReportId) await this.getReport(projectId, resolvedReportId);
    return this.start(project, 'estimate', baseline, {
      ...(resolvedReportId ? { estimateReportId: resolvedReportId } : {}),
      refreshHistory,
    });
  }
  /** Check approved requirements against a running app at the given or saved URL; no repository code runs. */
  async verify(
    projectId: string,
    url?: string,
    reason?: LookReason,
    delivery: Pick<RunExtras, 'runId' | 'beta'> = {},
  ): Promise<{ runId: string }> {
    const folder = this.store.project(projectId);
    const project = ProjectSchema.parse(await json(path.join(folder, 'project.json')));
    const baseline = await json<Baseline>(path.join(folder, 'baseline.json'));
    const verifyUrl = await resolveVerifyUrl(folder, url);
    return this.start(project, 'verify', baseline, {
      ...delivery,
      verifyUrl,
      ...(reason ? { reason } : {}),
    });
  }
  /** Persist initial run identity before launching work; failed setup always releases its project lock. */
  private async start(
    project: Project,
    kind: RunManifest['kind'],
    baseline?: Baseline,
    extra: RunExtras = {},
  ): Promise<{ runId: string }> {
    const release = await this.lockFor(project.id, kind);
    try {
      const run = await createRun(this.store, project, kind, baseline, extra);
      this.launch(run, release);
      return { runId: run.id };
    } catch (e) {
      await release();
      throw e;
    }
  }
  /** Explicitly resume an unfinished run under its original identity, retaining validated checkpoints. */
  async resume(projectId: string, runId: string): Promise<{ runId: string }> {
    const saved = await json<RunManifest>(
      path.join(this.store.run(projectId, runId), 'manifest.json'),
    );
    const release = await this.lockFor(projectId, saved.kind);
    try {
      const run = await json<RunManifest>(
        path.join(this.store.run(projectId, runId), 'manifest.json'),
      );
      if (run.id !== runId || run.projectId !== projectId)
        throw new Error('Run identity mismatch.');
      if (run.status === 'completed' || run.status === 'review')
        throw new Error('This run is already finished.');
      const current = ProjectSchema.parse(
        await json(path.join(this.store.project(projectId), 'project.json')),
      );
      if (
        run.project.repositories.some(
          (repo) =>
            JSON.stringify(repo.monitoredBranch) !==
            JSON.stringify(current.repositories.find((r) => r.id === repo.id)?.monitoredBranch),
        )
      )
        throw new Error('The monitored branch changed. Start a new check instead.');
      run.status = 'running';
      delete run.error;
      this.launch(run, release);
      return { runId };
    } catch (e) {
      await release();
      throw e;
    }
  }
  /** Await active work without starting or retrying it; an inactive run has nothing to wait for. */
  async wait(runId: string): Promise<void> {
    await this.active.get(runId)?.done;
  }
  /** Whether this worker is executing the run; saved manifests can still say running after a crash. */
  isActive(runId: string): boolean {
    return this.active.has(runId);
  }
  /** Whether this worker is executing any run for the project. */
  isBusy(projectId: string): boolean {
    return [...this.active.values()].some((a) => a.projectId === projectId);
  }
  /** Signal cancellation for active work; accepted report pointers remain owned by workflow commit guards. */
  cancel(runId: string): { cancelled: boolean } {
    const active = this.active.get(runId);
    if (!active) throw new Error('Run is not active.');
    active.controller.abort();
    return { cancelled: true };
  }
  /** Create an immutable reviewed baseline after rejecting stale intent and reused retired requirement IDs. */
  async approve(projectId: string, runId: string, productInput: unknown): Promise<Baseline> {
    const release = await this.lock(projectId);
    try {
      const run = await json<RunManifest>(
        path.join(this.store.run(projectId, runId), 'manifest.json'),
      );
      if (run.status !== 'review' || run.kind !== 'prepare')
        throw new Error('No pending requirements review for this run.');
      const project = await json<Project>(path.join(this.store.project(projectId), 'project.json'));
      if (hash(project.context) !== hash(run.project.context))
        throw new Error('This review is stale. Prepare requirements again.');
      return await commitBaseline(this.store, projectId, productInput, project.context);
    } finally {
      await release();
    }
  }
  /** Replace what done means with the person's edited version, keeping the current intent. */
  async editProduct(projectId: string, productInput: unknown): Promise<Baseline> {
    const release = await this.lock(projectId);
    try {
      const project = ProjectSchema.parse(
        await json(path.join(this.store.project(projectId), 'project.json')),
      );
      return await commitBaseline(this.store, projectId, productInput, project.context);
    } finally {
      await release();
    }
  }
  /** Load the prepared product for human review without treating it as an approved baseline. */
  async candidate(projectId: string, runId: string): Promise<Product> {
    return savedProduct(await json(path.join(this.store.run(projectId, runId), 'understand.json')));
  }
  /** Revalidate accepted reports against their saved baseline, snapshots, and read receipts before returning them. */
  async getReport(projectId: string, runId?: string): Promise<Report> {
    return readAcceptedReport(this.store, projectId, runId);
  }
  /** Export only accepted reports, optionally requiring an estimate tied to that exact report. */
  async export(
    projectId: string,
    runId: string,
    format: 'json' | 'markdown',
    includeEstimates = false,
  ): Promise<string> {
    return exportReport(this.store, projectId, runId, format, includeEstimates);
  }
  /** Return only estimates matching current baseline, source consent, and accepted report identity. */
  async getEstimate(projectId: string): Promise<EstimationSnapshot | null> {
    return readCurrentEstimate(this.store, projectId);
  }
  /** Recompute explicit user adjustments under the project lock while retaining suggested values. */
  async applyEstimateOverrides(
    projectId: string,
    input: EstimateOverrides,
  ): Promise<EstimationSnapshot> {
    const release = await this.lock(projectId);
    try {
      return await applyOverrides(this, projectId, input);
    } finally {
      await release();
    }
  }
  /** Read cited lines from the run's independent frozen objects, even if the source checkout later changes. */
  async evidence(
    projectId: string,
    runId: string,
    index: number,
    evidenceIndex: number,
  ): Promise<Evidence & { text: string }> {
    return readEvidence(this.store, projectId, runId, index, evidenceIndex);
  }
  /** Supply workflow dependencies without transferring run/lock ownership. */
  private workflowContext(): WorkflowContext {
    return {
      store: this.store,
      runtime: this.runtime,
      emit: this.emit,
      integrations: this.integrations,
      getReport: this.getReport.bind(this),
      getEstimate: this.getEstimate.bind(this),
    };
  }
  /** Track one bounded workflow and retain failure details in its manifest without automatic retries. */
  private launch(run: RunManifest, release: () => Promise<void>): void {
    launchRun(this.workflowContext(), run, release, this.active);
  }
  /** Cancel and await active runs before clearing provider keys and closing integration sessions. */
  async dispose(): Promise<void> {
    await closeCoding(this);
    for (const a of this.active.values()) a.controller.abort();
    await Promise.all([...this.active.values()].map((a) => a.done));
    if (this.runtime instanceof Runtimes) this.runtime.dispose();
    await this.integrations.dispose();
  }
}
