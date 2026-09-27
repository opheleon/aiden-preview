import type { UpdateChannel } from './update-channel.js';
/** Updater lifecycle states exposed to the renderer. */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'disabled'
  | 'error';

/** Download progress reported by the updater; byte counts describe the pending artifact. */
export type UpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

/** Recoverable updater status with sanitized error text and nullable discovery details. */
export type UpdateStatus = {
  state: UpdateState;
  currentVersion: string;
  latestVersion: string | null;
  progress: UpdateProgress | null;
  error: { message: string } | null;
  message: string | null;
  lastCheckedAt: string | null;
};

/** Persisted download consent and stable or beta release selection. */
export type UpdatePreferences = {
  autoDownload: boolean;
  channel: UpdateChannel;
};
