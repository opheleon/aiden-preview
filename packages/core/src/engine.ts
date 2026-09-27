import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  assertUniqueRequirements,
  type Baseline,
  type Discovery,
  type EstimateOverrides,
  type EstimationSnapshot,
  EstimationSnapshotSchema,
  type Evidence,
  type Product,
  ProductSchema,
  type Project,
  ProjectSchema,
  type ProjectSources,
  type ReadReceipt,
  type Report,
  type RunEvent,
  type RunManifest,
  validateReport,
} from '../../contracts/src/index.js';
import { ConnectionManager } from '../../integrations/src/index.js';
import { markdown, markdownBundle } from '../../reporting/src/index.js';
import { type AgentRuntime, publicError, Runtimes } from '../../runtimes/src/index.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import { readSnapshot } from '../../tools/src/git.js';
import { applyOverrides } from './estimate-overrides.js';
import { execute } from './report-workflow.js';
import { atomic, hash, json, optionalJson, Store, uid } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Own project locks and explicit run lifecycles while keeping accepted artifacts separate from in-flight work. */
export class Engine {
  private active = new Map<
    string,
    { controller: AbortController; done: Promise<void>; projectId: string }
  >();
  private questions = new Map<string, { runId: string; resolve: (answer: string) => void }>();
  /** Bind storage, provider, and integration dependencies without starting provider execution. */
  constructor(
    public store = new Store(),
    public runtime: AgentRuntime = new Runtimes(path.join(store.root, 'providers')),
    public emit: (event: RunEvent) => void = () => {},
    public integrations = new ConnectionManager(store.root),
  ) {}
  /** List saved project metadata; a new home returns no projects, while corruption remains an error. */
  async projects(): Promise<Project[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      const ids = await readdir(path.join(this.store.root, 'projects'));
      return (
        await Promise.all(
          ids.map((p) => optionalJson<Project>(path.join(this.store.project(p), 'project.json'))),
        )
      ).filter((project): project is Project => project !== null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  /** Load the current project, reviewed baseline, and run history without resuming interrupted work. */
  async state(
    projectId: string,
  ): Promise<{ project: Project | null; baseline: Baseline | null; runs: RunManifest[] }> {
    return {
      project: await optionalJson<Project>(
        path.join(this.store.project(projectId), 'project.json'),
      ),
      baseline: await optionalJson<Baseline>(
        path.join(this.store.project(projectId), 'baseline.json'),
      ),
      runs: await this.history(projectId),
    };
  }
  /** List persisted run manifests newest first, excluding directories without a manifest. */
  async history(projectId: string): Promise<RunManifest[]> {
    const rows = await Promise.all(
      (await this.store.listRuns(projectId)).map((r) =>
        optionalJson<RunManifest>(path.join(this.store.run(projectId, r), 'manifest.json')),
      ),
    );
    return rows
      .filter((r): r is RunManifest => !!r)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Acquire a per-project filesystem lock; remove only dead-process locks and release only our own token. */
  private async lock(projectId: string): Promise<() => Promise<void>> {
    const folder = this.store.project(projectId);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, 'active.lock');
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
      return this.lock(projectId);
    }
    return async () => {
      const current = await optionalJson<{ token: string }>(file);
      if (current?.token === token) await unlink(file);
    };
  }
  /** Validate repository boundaries and begin requirements discovery under an exclusive project lock. */
  async prepare(input: Project): Promise<{ runId: string }> {
    const project = await validateProjectRepositories(ProjectSchema.parse(input));
    return this.start(project, 'prepare');
  }
  /** Start analysis only when the approved context still matches the saved project intent. */
  async report(projectId: string): Promise<{ runId: string }> {
    const project = ProjectSchema.parse(
      await json(path.join(this.store.project(projectId), 'project.json')),
    );
    const baseline = await json<Baseline>(
      path.join(this.store.project(projectId), 'baseline.json'),
    );
    if (baseline.contextHash !== hash(project.context))
      throw new Error('Review the changed project context before running another report.');
    return this.start(project, 'report', baseline);
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
  /** Persist initial run identity before launching work; failed setup always releases its project lock. */
  private async start(
    project: Project,
    kind: RunManifest['kind'],
    baseline?: Baseline,
    extra: { estimateReportId?: string; refreshHistory?: boolean } = {},
  ): Promise<{ runId: string }> {
    const release = await this.lock(project.id);
    try {
      const run: RunManifest & { estimateReportId?: string; refreshHistory?: boolean } = {
        id: uid(),
        projectId: project.id,
        kind,
        status: 'running',
        stage: kind === 'prepare' ? 'understand' : kind === 'estimate' ? 'estimate' : 'sync',
        project,
        ...(baseline ? { baseline } : {}),
        createdAt: new Date().toISOString(),
        latestAtStart:
          (
            await optionalJson<{ id: string }>(
              path.join(this.store.project(project.id), 'latest.json'),
            )
          )?.id ?? null,
        ...extra,
      };
      await atomic(path.join(this.store.project(project.id), 'project.json'), project);
      await atomic(path.join(this.store.run(project.id, run.id), 'manifest.json'), run);
      this.launch(run, release);
      return { runId: run.id };
    } catch (e) {
      await release();
      throw e;
    }
  }
  /** Explicitly resume an unfinished run under its original identity, retaining validated checkpoints. */
  async resume(projectId: string, runId: string): Promise<{ runId: string }> {
    const release = await this.lock(projectId);
    try {
      const run = await json<RunManifest>(
        path.join(this.store.run(projectId, runId), 'manifest.json'),
      );
      if (run.id !== runId || run.projectId !== projectId)
        throw new Error('Run identity mismatch.');
      if (run.status === 'completed' || run.status === 'review')
        throw new Error('This run is already finished.');
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
  /** Signal cancellation for active work; accepted report pointers remain owned by workflow commit guards. */
  cancel(runId: string): { cancelled: boolean } {
    const active = this.active.get(runId);
    if (!active) throw new Error('Run is not active.');
    active.controller.abort();
    return { cancelled: true };
  }
  /** Resolve only a live question belonging to this run; blank answers leave the question pending. */
  answer(runId: string, questionId: string, answer: string): { accepted: boolean } {
    const q = this.questions.get(questionId);
    if (!q || q.runId !== runId) throw new Error('Clarification is no longer active.');
    if (!answer.trim()) throw new Error('An answer is required.');
    q.resolve(answer);
    this.questions.delete(questionId);
    return { accepted: true };
  }
  /** Create an immutable reviewed baseline after rejecting stale intent and reused retired requirement IDs. */
  async approve(projectId: string, runId: string, productInput: unknown): Promise<Baseline> {
    const release = await this.lock(projectId);
    try {
      const product = ProductSchema.parse(productInput);
      assertUniqueRequirements(product);
      const run = await json<RunManifest>(
        path.join(this.store.run(projectId, runId), 'manifest.json'),
      );
      if (run.status !== 'review' || run.kind !== 'prepare')
        throw new Error('No pending requirements review for this run.');
      const project = await json<Project>(path.join(this.store.project(projectId), 'project.json'));
      if (hash(project.context) !== hash(run.project.context))
        throw new Error('This review is stale. Prepare requirements again.');
      const prev = await optionalJson<Baseline>(
        path.join(this.store.project(projectId), 'baseline.json'),
      );
      const activeIds = new Set(prev?.product.requirements.map((r) => r.id) ?? []);
      const retired = new Set(prev?.retiredIds ?? []);
      const max = Math.max(0, ...[...activeIds, ...retired].map((id) => Number(id.slice(4))));
      for (const req of product.requirements) {
        if (retired.has(req.id) || (!activeIds.has(req.id) && Number(req.id.slice(4)) <= max))
          throw new Error(
            'Retired requirement IDs cannot be reused. Allocate new IDs above the historical maximum.',
          );
      }
      for (const old of activeIds)
        if (!product.requirements.some((r) => r.id === old)) retired.add(old);
      const baseline: Baseline = {
        id: uid(),
        projectId,
        contextHash: hash(project.context),
        product,
        retiredIds: [...retired],
        reviewedAt: new Date().toISOString(),
      };
      await atomic(
        path.join(this.store.project(projectId), 'baselines', `${baseline.id}.json`),
        baseline,
      );
      await atomic(path.join(this.store.project(projectId), 'baseline.json'), baseline);
      return baseline;
    } finally {
      await release();
    }
  }
  /** Load the prepared product for human review without treating it as an approved baseline. */
  async candidate(projectId: string, runId: string): Promise<Product> {
    return json<Product>(path.join(this.store.run(projectId, runId), 'understand.json'));
  }
  /** Revalidate accepted reports against their saved baseline, snapshots, and read receipts before returning them. */
  async getReport(projectId: string, runId?: string): Promise<Report> {
    const resolved =
      runId ??
      (await json<{ id: string }>(path.join(this.store.project(projectId), 'latest.json'))).id;
    const dir = this.store.run(projectId, resolved);
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
  /** Export only accepted reports, optionally requiring an estimate tied to that exact report. */
  async export(
    projectId: string,
    runId: string,
    format: 'json' | 'markdown',
    includeEstimates = false,
  ): Promise<string> {
    const r = await this.getReport(projectId, runId);
    if (!includeEstimates) return format === 'json' ? JSON.stringify(r, null, 2) : markdown(r);
    const estimate = await this.getEstimate(projectId);
    if (!estimate || estimate.reportId !== r.id)
      throw new Error('No accepted estimation snapshot matches this report. Re-estimate first.');
    return format === 'json'
      ? JSON.stringify(
          { schemaVersion: '1.0', projectId, report: r, estimation: estimate },
          null,
          2,
        )
      : markdownBundle(r, estimate);
  }
  /** Return only estimates matching current baseline, source consent, and accepted report identity. */
  async getEstimate(projectId: string): Promise<EstimationSnapshot | null> {
    const pointer = await optionalJson<{ id: string }>(
      path.join(this.store.project(projectId), 'latest-estimate.json'),
    );
    if (!pointer) return null;
    const snapshot = EstimationSnapshotSchema.parse(
      await json(path.join(this.store.project(projectId), 'estimates', `${pointer.id}.json`)),
    );
    const baseline = await optionalJson<Baseline>(
      path.join(this.store.project(projectId), 'baseline.json'),
    );
    if (!baseline || snapshot.baselineId !== baseline.id) return null;
    const latestReport = await optionalJson<{ id: string }>(
      path.join(this.store.project(projectId), 'latest.json'),
    );
    if (snapshot.reportId && latestReport?.id !== snapshot.reportId) return null;
    const project = ProjectSchema.parse(
      await json(path.join(this.store.project(projectId), 'project.json')),
    );
    if (
      snapshot.sourceSelectionHash !==
      hash(project.sources ?? { contextConnectionIds: [], history: null })
    )
      return null;
    return snapshot;
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
  /** Read cited lines from the run’s independent frozen objects, even if the source checkout later changes. */
  async evidence(
    projectId: string,
    runId: string,
    index: number,
    evidenceIndex: number,
  ): Promise<Evidence & { text: string }> {
    const r = await this.getReport(projectId, runId);
    const e = r.assessments[index]?.evidence[evidenceIndex];
    if (!e) throw new Error('Evidence not found.');
    const run = await json<RunManifest>(
      path.join(this.store.run(projectId, runId), 'manifest.json'),
    );
    const repo = run.project.repositories.find((x) => x.id === e.repositoryId)!;
    const s = r.snapshots.find((x) => x.repositoryId === e.repositoryId && x.sha === e.sha)!;
    const text = await readSnapshot(
      { ...repo, path: path.join(this.store.run(projectId, runId), 'snapshots', repo.id) },
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
  /** Supply workflow dependencies without transferring run/lock ownership. */
  private workflowContext(): WorkflowContext {
    return {
      store: this.store,
      runtime: this.runtime,
      emit: this.emit,
      integrations: this.integrations,
      getReport: this.getReport.bind(this),
      getEstimate: this.getEstimate.bind(this),
      questions: this.questions,
    };
  }
  /** Track one bounded workflow and retain failure details in its manifest without automatic retries. */
  private launch(run: RunManifest, release: () => Promise<void>): void {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Run exceeded 30 minutes.')),
      30 * 60 * 1000,
    );
    const done = execute(this.workflowContext(), run, controller.signal)
      .catch(async (e) => {
        run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = controller.signal.aborted ? 'Run cancelled or timed out.' : publicError(e);
        await atomic(path.join(this.store.run(run.projectId, run.id), 'manifest.json'), run);
        this.emit({
          type: run.status,
          runId: run.id,
          projectId: run.projectId,
          message: run.error,
        });
      })
      .finally(async () => {
        clearTimeout(timer);
        for (const [id, q] of this.questions) if (q.runId === run.id) this.questions.delete(id);
        try {
          await release();
        } finally {
          this.active.delete(run.id);
        }
      });
    // The worker starts runs without waiting; wait() still exposes persistence or cleanup failures.
    void done.catch(() => {});
    this.active.set(run.id, { controller, done, projectId: run.projectId });
  }
  /** Cancel and await active runs before clearing provider keys and closing integration sessions. */
  async dispose(): Promise<void> {
    for (const a of this.active.values()) a.controller.abort();
    await Promise.all([...this.active.values()].map((a) => a.done));
    if (this.runtime instanceof Runtimes) this.runtime.dispose();
    await this.integrations.dispose();
  }
}
