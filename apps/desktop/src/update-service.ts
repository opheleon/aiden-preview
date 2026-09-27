import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { defaultUpdateChannel } from './update-channel.js';
import type { UpdatePreferences, UpdateProgress, UpdateStatus } from './update-types.js';

const preferencesSchema = z.object({
  autoDownload: z.boolean(),
  channel: z.enum(['stable', 'beta']),
});
const infoSchema = z.object({ version: z.string() });
const progressSchema = z.object({
  percent: z.number().finite(),
  transferred: z.number().nonnegative(),
  total: z.number().nonnegative(),
  bytesPerSecond: z.number().nonnegative(),
});

/** The updater adapter exposes only operations used by the desktop lifecycle. */
export interface UpdateBackend {
  autoDownload: boolean;
  allowPrerelease: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (payload: unknown) => void): unknown;
  removeListener(event: string, listener: (payload: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent: boolean, forceRunAfter: boolean): void;
}

/** Environment and side effects supplied by Electron, or deterministic test substitutes. */
export interface UpdateServiceOptions {
  dataRoot: string;
  version: string;
  enabled: boolean;
  backend: UpdateBackend;
  isRunActive: () => boolean;
  publish: (status: UpdateStatus) => void;
}

/** Persist update preferences and expose recoverable update state without provider or source data. */
export class UpdateService {
  private status: UpdateStatus;
  private preferences: UpdatePreferences;
  private readonly preferencesPath: string;
  private readonly listeners: Array<{ event: string; listener: (payload: unknown) => void }> = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private closed = false;
  private started = false;
  private writes = Promise.resolve();

  /** Initialize without accessing disk or starting network activity. */
  constructor(private readonly options: UpdateServiceOptions) {
    this.preferencesPath = path.join(options.dataRoot, 'preferences', 'updates.json');
    this.preferences = { autoDownload: true, channel: defaultUpdateChannel(options.version) };
    this.status = {
      state: 'idle',
      currentVersion: options.version,
      latestVersion: null,
      progress: null,
      error: null,
      message: null,
      lastCheckedAt: null,
    };
  }

  /** Load preferences, bind events once, and schedule bounded background checks. */
  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    await this.loadPreferences();
    if (this.closed) return;
    if (!this.options.enabled) {
      this.setStatus({
        state: 'disabled',
        message: 'Automatic updates are available in the installed desktop app.',
      });
      return;
    }
    this.applyPreferences();
    // Explicit installation is required so quitting during a paid run cannot apply an update.
    this.options.backend.autoInstallOnAppQuit = false;
    this.listen('checking-for-update', () =>
      this.setStatus({ state: 'checking', error: null, message: null }),
    );
    this.listen('update-available', (info) => {
      const parsed = infoSchema.safeParse(info);
      if (!parsed.success) return this.fail();
      this.setStatus({
        state: 'available',
        latestVersion: parsed.data.version,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: this.preferences.autoDownload ? 'Downloading the update in the background.' : null,
      });
    });
    this.listen('update-not-available', () =>
      this.setStatus({
        state: 'up-to-date',
        latestVersion: null,
        progress: null,
        error: null,
        message: null,
        lastCheckedAt: new Date().toISOString(),
      }),
    );
    this.listen('download-progress', (value) => this.receiveProgress(value));
    this.listen('update-downloaded', (info) => {
      const parsed = infoSchema.safeParse(info);
      if (!parsed.success) return this.fail();
      this.setStatus({
        state: 'downloaded',
        latestVersion: parsed.data.version,
        progress: null,
        error: null,
        message: 'Restart Aiden when you are ready to apply the update.',
      });
    });
    this.listen('error', () => this.fail());
    const initial = setTimeout(() => void this.check(), 30_000);
    const interval = setInterval(() => void this.check(), 12 * 60 * 60_000);
    initial.unref();
    interval.unref();
    this.timers = [initial, interval];
  }

  /** Return a detached snapshot so callers cannot mutate lifecycle state. */
  snapshot(): UpdateStatus {
    return structuredClone(this.status);
  }

  /** Return a detached preferences object for the renderer. */
  getPreferences(): UpdatePreferences {
    return { ...this.preferences };
  }

  /** Serialize preference writes; only apply a preference after its atomic replacement succeeds. */
  async setPreferences(next: UpdatePreferences): Promise<UpdatePreferences> {
    const parsed = preferencesSchema.parse(next);
    const operation = this.writes.then(async () => {
      if (this.closed) throw new Error('The updater has been closed.');
      await this.savePreferences(parsed);
      const channelChanged = parsed.channel !== this.preferences.channel;
      this.preferences = parsed;
      this.applyPreferences();
      if (channelChanged && this.status.state !== 'disabled') void this.check();
      else if (parsed.autoDownload && this.status.state === 'available') void this.download();
    });
    this.writes = operation.catch(() => {
      /* Keep later preference writes recoverable. */
    });
    await operation;
    return this.getPreferences();
  }

  /** Check once unless disabled, disposed, or an update operation is already active. */
  async check(): Promise<UpdateStatus> {
    if (
      this.closed ||
      ['disabled', 'checking', 'downloading', 'downloaded'].includes(this.status.state)
    )
      return this.snapshot();
    this.setStatus({ state: 'checking', error: null, message: null });
    try {
      const result = await this.options.backend.checkForUpdates();
      // Automatic downloads finish after the check returns. Observe their rejection without
      // blocking the renderer's check request for the duration of a large download.
      if (
        result &&
        typeof result === 'object' &&
        'downloadPromise' in result &&
        result.downloadPromise instanceof Promise
      )
        void result.downloadPromise.catch(() => this.fail());
    } catch {
      this.fail();
    }
    return this.snapshot();
  }

  /** Download an offered version or retry its failed download without restarting analysis. */
  async download(): Promise<UpdateStatus> {
    const retryable = this.status.state === 'error' && !!this.status.latestVersion;
    if (this.closed || (this.status.state !== 'available' && !retryable)) return this.snapshot();
    this.setStatus({
      state: 'downloading',
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: null,
      message: null,
    });
    try {
      await this.options.backend.downloadUpdate();
    } catch {
      this.fail();
    }
    return this.snapshot();
  }

  /** Apply only downloaded updates and recheck active work immediately before quitting. */
  install(): UpdateStatus {
    if (this.closed || this.status.state !== 'downloaded') return this.snapshot();
    if (this.options.isRunActive()) {
      this.setStatus({
        message: 'Finish or cancel the active assessment before restarting to update.',
      });
      return this.snapshot();
    }
    setImmediate(() => {
      if (this.closed || this.options.isRunActive()) return;
      try {
        this.options.backend.quitAndInstall(false, true);
      } catch {
        this.fail();
      }
    });
    return this.snapshot();
  }

  /** Stop timers and remove only this service's listeners; late results cannot publish. */
  dispose(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    for (const { event, listener } of this.listeners)
      this.options.backend.removeListener(event, listener);
    this.listeners.length = 0;
  }

  /** Restore validated preferences; corrupted state falls back to the current build channel. */
  private async loadPreferences(): Promise<void> {
    try {
      this.preferences = preferencesSchema.parse(
        JSON.parse(await readFile(this.preferencesPath, 'utf8')),
      );
    } catch {
      /* Defaults remain usable offline and after an interrupted preference write. */
    }
    if (this.preferences.channel === 'beta')
      await this.savePreferences(this.preferences).catch(() => {
        /* Read-only storage must not prevent startup. */
      });
  }

  /** Replace the preferences file with owner-only permissions, never in-place truncation. */
  private async savePreferences(value: UpdatePreferences): Promise<void> {
    await mkdir(path.dirname(this.preferencesPath), { recursive: true });
    const temporary = `${this.preferencesPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.preferencesPath);
  }

  /** Match download and prerelease routing to the persisted user preference. */
  private applyPreferences(): void {
    this.options.backend.autoDownload = this.preferences.autoDownload;
    this.options.backend.allowPrerelease = this.preferences.channel === 'beta';
  }

  /** Register a listener whose lifetime belongs to this service instance. */
  private listen(event: string, listener: (payload: unknown) => void): void {
    this.listeners.push({ event, listener });
    this.options.backend.on(event, listener);
  }

  /** Reject malformed progress and constrain its visible percentage to a valid range. */
  private receiveProgress(value: unknown): void {
    const parsed = progressSchema.safeParse(value);
    if (!parsed.success) return this.fail();
    const progress: UpdateProgress = {
      ...parsed.data,
      percent: Math.max(0, Math.min(100, parsed.data.percent)),
    };
    this.setStatus({ state: 'downloading', progress, error: null, message: null });
  }

  /** Surface a retryable generic error without leaking URLs, tokens, or private paths. */
  private fail(): void {
    this.setStatus({
      state: 'error',
      progress: null,
      error: { message: 'The update could not be completed. Check your connection and retry.' },
      message: null,
    });
  }

  /** Publish detached lifecycle state only while the service is alive. */
  private setStatus(patch: Partial<UpdateStatus>): void {
    if (this.closed) return;
    this.status = { ...this.status, ...patch };
    this.options.publish(this.snapshot());
  }
}
