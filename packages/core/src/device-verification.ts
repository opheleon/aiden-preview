import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod/v3';

import {
  type DeviceRun,
  DeviceRunSchema,
  type DeviceSource,
  type DeviceTarget,
  DeviceTargetSchema,
  type DeviceTest,
  DeviceTestSchema,
} from '../../contracts/src/device-verification.js';
import type { AgentRuntime } from '../../runtimes/src/index.js';
import { AppiumDevice } from '../../verification/src/appium.js';
import { renderDeviceReport } from '../../verification/src/device-report.js';
import { ManagedAppium } from '../../verification/src/managed-appium.js';
import { deviceAttempt } from './device-attempt.js';
import { PhoneConnectionSetup } from './phone-setup.js';
import { atomic, boundedPath, hash, optionalJson } from './storage.js';

/** Own phone sessions and evidence; project orchestration supplies immutable assessment provenance. */
export class DeviceVerification {
  private closing = false;
  readonly setup: PhoneConnectionSetup;
  private active = new Map<
    string,
    { controller: AbortController; done: Promise<void>; projectId?: string }
  >();
  /** Keep the worker's provider, storage home, and optionally injected driver transport. */
  constructor(
    private root: string,
    private runtime: AgentRuntime,
    private http = fetch,
  ) {
    this.setup = new PhoneConnectionSetup(root);
  }
  /** Resolve internal run storage; callers validate run identifiers at the worker boundary. */
  private folder(id: string): string {
    return path.join(this.root, 'device-runs', z.string().uuid().parse(id));
  }
  /** Claim a physical device across workers; stale locks are retained for explicit operator recovery. */
  private async lock(target: DeviceTarget): Promise<() => Promise<void>> {
    const parent = path.join(this.root, 'device-locks');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const file = path.join(parent, hash(target.udid));
    try {
      await mkdir(file, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          'This phone is already in use. Stop its device test before starting another.',
          { cause: error },
        );
      throw error;
    }
    return () => rm(file, { recursive: true, force: true });
  }
  /** Verify the control bridge can open and capture the installed app without a model turn or test interaction. */
  probe(input: unknown): Promise<Record<string, string>> {
    if (this.closing) return Promise.reject(new Error('Device verification is shutting down.'));
    const target = DeviceTargetSchema.parse(input);
    const id = randomUUID();
    const controller = new AbortController();
    const result = this.probeDevice(
      target,
      AbortSignal.any([controller.signal, AbortSignal.timeout(110000)]),
    );
    const done = result
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.active.delete(id);
      });
    this.active.set(id, { controller, done });
    return result;
  }
  /** Release a connection probe on completion or shutdown, retaining a lock when cleanup fails. */
  private async probeDevice(
    target: DeviceTarget,
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    const unlock = await this.lock(target);
    const server = new ManagedAppium();
    let device: AppiumDevice | undefined;
    try {
      device = await this.connect(target, signal, server);
      await device.open();
      await device.screenshot();
      return device.metadata;
    } finally {
      try {
        await device?.close();
        await unlock();
      } finally {
        await server.stop();
      }
    }
  }
  /** Start an explicit test and return immediately so the desktop remains responsive and cancellable. */
  async start(input: unknown, source?: DeviceSource): Promise<{ runId: string }> {
    if (this.closing) throw new Error('Device verification is shutting down.');
    const config = DeviceTestSchema.parse(input);
    const unlock = await this.lock(config.target);
    const id = randomUUID();
    const controller = new AbortController();
    const run: DeviceRun = {
      id,
      ownerPid: process.pid,
      ...(source ? { source } : {}),
      name: config.name,
      bundleId: config.target.bundleId,
      buildLabel: config.buildLabel,
      device: {},
      runtime: config.runtime,
      runtimeVersion: null,
      status: 'running',
      message: 'Connecting to the installed app.',
      startedAt: new Date().toISOString(),
      criteria: [],
      reportPath: path.join(this.folder(id), 'report.html'),
    };
    try {
      await this.save(run);
      if (this.closing) throw new Error('Device verification is shutting down.');
    } catch (error) {
      await unlock();
      throw error;
    }
    const done = this.execute(config, run, controller.signal)
      .then(async (closed) => {
        if (closed) await unlock();
      })
      .finally(() => {
        this.active.delete(id);
      });
    // Attach a rejection handler immediately; storage errors remain visible through the run status.
    void done.catch(() => {});
    this.active.set(id, { controller, done, ...(source ? { projectId: source.projectId } : {}) });
    return { runId: id };
  }
  /** Persist partial evidence after each criterion; no retries can repeat writes to the test account. */
  private async execute(config: DeviceTest, run: DeviceRun, signal: AbortSignal): Promise<boolean> {
    let closed = true;
    signal = AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)]);
    const server = new ManagedAppium();
    let device: AppiumDevice | undefined;
    try {
      device = await this.connect(config.target, signal, server);
      await device.open();
      run.device = device.metadata;
      const workspace = path.join(this.folder(run.id), 'workspace');
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      for (const [index, criterion] of config.criteria.entries()) {
        signal.throwIfAborted();
        run.message = `Checking ${index + 1} of ${config.criteria.length}: ${criterion}`;
        await this.save(run);
        const result = await deviceAttempt(
          { runtime: this.runtime, config, run, workspace, signal },
          device,
          criterion,
          path.join(this.folder(run.id), `criterion-${index + 1}`),
        );
        run.criteria.push(result);
        await this.save(run);
      }
      signal.throwIfAborted();
      run.status = 'completed';
      run.message = `${run.criteria.filter((c) => c.verdict === 'pass').length} of ${run.criteria.length} criteria verified.`;
    } catch {
      run.status = signal.aborted ? 'cancelled' : 'failed';
      run.message = signal.aborted
        ? 'Device test stopped. Completed evidence is preserved.'
        : 'Could not finish. Check the Appium server, paired phone, installed app, and selected provider connection.';
    } finally {
      try {
        await device?.close();
      } catch {
        closed = false;
        run.status = 'failed';
        run.message =
          'The phone session could not be closed. Stop the Appium session before testing again.';
      }
      await server.stop();
      await this.save(run);
    }
    return closed;
  }
  /** Resolve managed connections at run time and refresh installed build metadata before testing. */
  private async connect(
    target: DeviceTarget,
    signal: AbortSignal,
    server: ManagedAppium,
  ): Promise<AppiumDevice> {
    if (target.connection !== 'managed') return new AppiumDevice(target, signal, this.http);
    const apps = await this.setup.apps(target.udid);
    signal.throwIfAborted();
    const app = apps.find((item) => item.bundleId === target.bundleId);
    if (!app) throw new Error('Install the selected app on this iPhone before connecting.');
    const signing = await this.setup.read();
    const serverUrl = await server.start(signal);
    const device = new AppiumDevice({ ...target, serverUrl }, signal, this.http, signing);
    device.metadata.appVersion = app.version;
    device.metadata.appBuild = app.build;
    device.metadata.appName = app.name;
    return device;
  }
  /** Write private machine-readable results and a portable screenshot report. */
  private async save(run: DeviceRun): Promise<void> {
    await atomic(path.join(this.folder(run.id), 'run.json'), run);
    await writeFile(run.reportPath, renderDeviceReport(run), { mode: 0o600 });
  }
  /** Read recent history and mark orphaned running records as interrupted without rerunning them. */
  async list(): Promise<DeviceRun[]> {
    let ids: string[];
    try {
      ids = await readdir(path.join(this.root, 'device-runs'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const runs = await Promise.all(
      ids.filter((id) => /^[a-f0-9-]{36}$/.test(id)).map((id) => this.read(id)),
    );
    return runs
      .filter((r): r is DeviceRun => r !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  /** Return a saved run, keeping interrupted device sessions distinct from completed verification. */
  async read(id: string): Promise<DeviceRun | null> {
    z.string().uuid().parse(id);
    const file = await boundedPath(this.root, `device-runs/${id}/run.json`);
    const saved = await optionalJson(file);
    if (!saved) return null;
    const run = DeviceRunSchema.parse(saved);
    if (run.id !== id) throw new Error('Saved device run identity does not match its folder.');
    run.reportPath = await boundedPath(this.root, `device-runs/${id}/report.html`);
    if (run.status === 'running' && !this.active.has(id) && !otherWorkerAlive(run.ownerPid))
      return {
        ...run,
        status: 'failed',
        message: 'Interrupted. Check the phone and Appium session before starting again.',
      };
    return run;
  }
  /** Await completion without polling or repeating any phone actions. */
  async wait(id: string): Promise<void> {
    await this.active.get(id)?.done;
  }
  /** Keep project decisions and monitoring aware of the phone verification phase. */
  isBusy(projectId: string): boolean {
    return [...this.active.values()].some((run) => run.projectId === projectId);
  }
  /** Cancel only an owned device run, allowing cleanup to complete asynchronously. */
  cancel(id: string): { cancelled: boolean } {
    const active = this.active.get(id);
    active?.controller.abort();
    return { cancelled: Boolean(active) };
  }
  /** Stop all sessions before the worker exits; cleanup does not inherit cancelled signals. */
  async dispose(): Promise<void> {
    this.closing = true;
    for (const item of this.active.values()) item.controller.abort();
    await Promise.allSettled([...this.active.values()].map((item) => item.done));
  }
}

/** Distinguish another active local worker from a run interrupted in this process. */
function otherWorkerAlive(pid: number): boolean {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
