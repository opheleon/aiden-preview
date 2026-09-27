import { createRequire } from 'node:module';

import { app, BrowserWindow } from 'electron';

import { UpdateService } from './update-service.js';
export type {
  UpdatePreferences,
  UpdateProgress,
  UpdateState,
  UpdateStatus,
} from './update-types.js';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

/** Bind the independently testable update lifecycle to Electron's signed updater and windows. */
export class DesktopUpdater extends UpdateService {
  /** Preserve the existing caller API and legacy development-update environment flag. */
  constructor(options: { dataRoot: string; isRunActive: () => boolean }) {
    const forceDevelopmentUpdates =
      process.env.AIDEN_FORCE_DEV_UPDATES === '1' || process.env.OPHELEON_FORCE_DEV_UPDATES === '1';
    autoUpdater.logger = null;
    autoUpdater.forceDevUpdateConfig = forceDevelopmentUpdates;
    super({
      ...options,
      version: app.getVersion(),
      enabled: app.isPackaged || forceDevelopmentUpdates,
      backend: autoUpdater,
      publish: (status) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('updates:status', status);
        }
      },
    });
  }
}
