import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../packages/contracts/src/api.js';
import type { RunEvent } from '../../../packages/contracts/src/index.js';
import type { UpdatePreferences, UpdateStatus } from './updater.js';
/** Narrow preload API; privileged operations are validated again in the main process and worker. */
export type DesktopBridge = {
  request: <K extends WorkerMethod>(
    method: K,
    params?: WorkerParams<K>,
  ) => Promise<WorkerResult<K>>;
  chooseProjectFolder: () => Promise<string | null>;
  chooseContext: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  saveExport: (params: {
    projectId: string;
    runId: string;
    format: 'json' | 'markdown';
    includeEstimates?: boolean;
  }) => Promise<boolean>;
  openVerificationReport: (params: { projectId: string; runId: string }) => Promise<void>;
  /** Read a recording or screenshot named by a saved browser check, for in-app playback. */
  verificationMedia: (params: {
    projectId: string;
    runId: string;
    file: string;
  }) => Promise<{ type: string; data: ArrayBuffer }>;
  getAppVersion: () => Promise<string>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  getUpdatePreferences: () => Promise<UpdatePreferences>;
  setUpdatePreferences: (preferences: UpdatePreferences) => Promise<UpdatePreferences>;
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadUpdate: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<UpdateStatus>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onEvent: (callback: (event: RunEvent) => void) => () => void;
};

/** The preload is present only in the desktop renderer. */
declare global {
  interface Window {
    aiden?: DesktopBridge;
  }
}
