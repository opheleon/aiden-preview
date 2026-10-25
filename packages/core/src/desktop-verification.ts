import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod/v3';

import {
  type DesktopApp,
  DesktopAppSchema,
  type DesktopCriterion,
  type DesktopReadiness,
  type DesktopRun,
  DesktopRunSchema,
  type DesktopTest,
  DesktopTestSchema,
} from '../../contracts/src/desktop-verification.js';
import type { AgentRuntime } from '../../runtimes/src/index.js';
import {
  DesktopAppSession,
  desktopReadiness,
  installedApps,
  requestDesktopAccess,
} from '../../verification/src/desktop-app.js';
import { renderDesktopReport } from '../../verification/src/desktop-report.js';
import { DesktopSession } from '../../verification/src/desktop-session.js';
import { evidenceAttempt } from './device-attempt.js';
import { atomic, boundedPath, hash, optionalJson } from './storage.js';

/** Platform helpers; tests replace them so no real app is driven. */
export interface DesktopHost {
  readiness(): Promise<DesktopReadiness>;
  requestAccess(): Promise<void>;
  apps(): Promise<DesktopApp[]>;
  open(appPath: string): DesktopAppSession;
}

const defaultHost: DesktopHost = {
  readiness: () => desktopReadiness(),
  requestAccess: () => requestDesktopAccess(),
  apps: () => installedApps(),
  open: (appPath) => DesktopAppSession.start(appPath),
};

/** Own desktop test runs against apps already installed on this computer. */
export class DesktopVerification {
  /**
   * Publishers the signed-in person's teams allow, or null when not signed in to Teams. The Teams
   * methods replace this; a failed read rejects so a test never runs without the team's policy.
   */
  teamPublishers: () => Promise<string[] | null> = () => Promise.resolve(null);
  private closing = false;
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  /** Keep the worker's provider and storage home; the host helpers are injectable for tests. */
  constructor(
    private root: string,
    private runtime: AgentRuntime,
    private host: DesktopHost = defaultHost,
  ) {}
  /** Resolve internal run storage; callers validate run identifiers at the worker boundary. */
  private folder(id: string): string {
    return path.join(this.root, 'desktop-runs', z.string().uuid().parse(id));
  }
  /** Report the permissions the person still needs to allow. */
  readiness(): Promise<DesktopReadiness> {
    return this.host.readiness();
  }
  /** Show the operating system's permission prompts, then report the result. */
  async requestAccess(): Promise<DesktopReadiness> {
    await this.host.requestAccess();
    return this.host.readiness();
  }
  /** Installed apps the person can choose from. */
  apps(): Promise<DesktopApp[]> {
    return this.host.apps();
  }
  /** Claim one app; only one test drives a given app at a time. */
  private async lock(appPath: string): Promise<() => Promise<void>> {
    const parent = path.join(this.root, 'desktop-locks');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const file = path.join(parent, hash(path.resolve(appPath)));
    try {
      await mkdir(file, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('This app is already being tested. Stop that test first.', {
          cause: error,
        });
      throw error;
    }
    return () => rm(file, { recursive: true, force: true });
  }
  /** Start an explicit test and return immediately so the caller stays responsive and can cancel. */
  async start(input: unknown): Promise<{ runId: string }> {
    if (this.closing) throw new Error('Desktop verification is shutting down.');
    const config = DesktopTestSchema.parse(input);
    const unlock = await this.lock(config.target.appPath);
    const id = randomUUID();
    const controller = new AbortController();
    const run: DesktopRun = {
      id,
      ownerPid: process.pid,
      name: config.name,
      app: null,
      versionAfter: null,
      runtime: config.runtime,
      runtimeVersion: null,
      status: 'running',
      message: 'Opening the app.',
      startedAt: new Date().toISOString(),
      criteria: [],
      reportPath: path.join(this.folder(id), 'report.html'),
    };
    try {
      await this.save(run);
    } catch (error) {
      await unlock();
      throw error;
    }
    const done = this.execute(config, run, controller.signal)
      .finally(unlock)
      .finally(() => this.active.delete(id));
    void done.catch(() => {});
    this.active.set(id, { controller, done });
    return { runId: id };
  }
  /** Open the app, check its signer, run every criterion, and record the version afterwards. */
  private async execute(config: DesktopTest, run: DesktopRun, outer: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([outer, AbortSignal.timeout(45 * 60_000)]);
    let app: DesktopAppSession | undefined;
    try {
      const readiness = await this.host.readiness();
      if (!readiness.ready)
        throw new Error(readiness.checks.find((check) => !check.ready)?.message ?? 'Not ready.');
      app = this.host.open(config.target.appPath);
      await this.open(run, app, signal);
      for (const [index, criterion] of config.criteria.entries()) {
        signal.throwIfAborted();
        run.message = `Checking ${index + 1} of ${config.criteria.length}: ${criterion}`;
        await this.save(run);
        run.criteria.push(await this.check(config, run, app, criterion, index, signal));
        await this.save(run);
      }
      signal.throwIfAborted();
      run.status = 'completed';
      run.message = `${run.criteria.filter((c) => c.verdict === 'pass').length} of ${run.criteria.length} criteria verified.`;
    } catch (error) {
      run.status = outer.aborted ? 'cancelled' : 'failed';
      run.message = outer.aborted
        ? 'Desktop test stopped. Completed evidence is preserved.'
        : error instanceof Error && run.criteria.length === 0
          ? error.message.slice(0, 300)
          : 'Could not finish. Check the app, Aiden permissions, and the selected provider connection.';
    } finally {
      if (app && run.app) run.versionAfter = await versionNow(app);
      app?.close();
      await this.save(run);
    }
  }
  /** Open or attach to the app, then refuse it when the team does not allow its publisher. */
  private async open(run: DesktopRun, app: DesktopAppSession, signal: AbortSignal): Promise<void> {
    let allowed: string[] | null;
    try {
      allowed = await this.teamPublishers();
    } catch {
      throw new Error("Could not read your team's allowed app publishers. Check your connection.");
    }
    run.app = DesktopAppSchema.parse(await app.request({ op: 'open' }, signal, 90000));
    const signer = run.app.signer?.toLowerCase();
    if (allowed?.length && !allowed.some((publisher) => publisher.toLowerCase() === signer))
      throw new Error(
        `Your team allows testing apps from ${allowed.join(', ')} only. ${run.app.name} is signed by ${run.app.signer ?? 'nobody'}.`,
      );
  }
  /** Run one criterion through the shared actor and independent reviewer turns. */
  private async check(
    config: DesktopTest,
    run: DesktopRun,
    app: DesktopAppSession,
    criterion: string,
    index: number,
    signal: AbortSignal,
  ): Promise<DesktopCriterion> {
    const dir = path.join(this.folder(run.id), `criterion-${index + 1}`);
    const workspace = path.join(this.folder(run.id), 'workspace');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const session = new DesktopSession(app, dir, config.stepLimit, signal);
    return evidenceAttempt(
      { runtime: this.runtime, config, run, workspace, signal },
      session,
      criterion,
      dir,
      {
        actor: 'verify-desktop.md',
        review: 'verify-desktop-review.md',
        evidenceTool: 'view_desktop_evidence',
      },
    );
  }
  /** Write private machine-readable results and a portable screenshot report. */
  private async save(run: DesktopRun): Promise<void> {
    await atomic(path.join(this.folder(run.id), 'run.json'), run);
    await writeFile(run.reportPath, renderDesktopReport(run), { mode: 0o600 });
  }
  /** Read recent history and mark orphaned running records as interrupted without rerunning them. */
  async list(): Promise<DesktopRun[]> {
    let ids: string[];
    try {
      ids = await readdir(path.join(this.root, 'desktop-runs'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const runs = await Promise.all(
      ids.filter((id) => /^[a-f0-9-]{36}$/.test(id)).map((id) => this.read(id)),
    );
    return runs
      .filter((r): r is DesktopRun => r !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  /** Return a saved run; a running record owned by no live worker is shown as interrupted. */
  async read(id: string): Promise<DesktopRun | null> {
    z.string().uuid().parse(id);
    const ownedAtRead = this.active.has(id);
    const saved = await optionalJson(await boundedPath(this.root, `desktop-runs/${id}/run.json`));
    if (!saved) return null;
    const run = DesktopRunSchema.parse(saved);
    if (run.id !== id) throw new Error('Saved desktop run identity does not match its folder.');
    run.reportPath = await boundedPath(this.root, `desktop-runs/${id}/report.html`);
    if (run.status === 'running' && !ownedAtRead && !this.active.has(id) && !alive(run.ownerPid))
      return { ...run, status: 'failed', message: 'Interrupted before it finished.' };
    return run;
  }
  /** Await completion without polling or repeating any app actions. */
  async wait(id: string): Promise<void> {
    await this.active.get(id)?.done;
  }
  /** Cancel an owned run; the app stays open. */
  cancel(id: string): { cancelled: boolean } {
    const active = this.active.get(id);
    active?.controller.abort();
    return { cancelled: Boolean(active) };
  }
  /** Stop all runs before the worker exits. */
  async dispose(): Promise<void> {
    this.closing = true;
    for (const item of this.active.values()) item.controller.abort();
    await Promise.allSettled([...this.active.values()].map((item) => item.done));
  }
}

/** The installed version after the test, or null when the app cannot be read. */
function versionNow(app: DesktopAppSession): Promise<string | null> {
  return app
    .request({ op: 'identity' }, AbortSignal.timeout(15000))
    .then((value) => DesktopAppSchema.parse(value).version)
    .catch(() => null);
}

/** Whether another local worker that owns a run is still alive. */
function alive(pid: number): boolean {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
