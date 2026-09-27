import { readFile, writeFile } from 'node:fs/promises';

import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod/v3';

import { id } from '../../../packages/contracts/src/index.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import { type LocalScheduler, ScheduleConfigSchema } from './scheduler.js';
import type { DesktopUpdater } from './updater.js';
/** Reject IPC originating outside the trusted top-level desktop renderer. */
export type IpcAuthorization = (event: Electron.IpcMainInvokeEvent) => void;
/** Register preference operations; mutable inputs are validated before reaching local services. */
export function registerPreferenceIpc(
  authorized: IpcAuthorization,
  scheduler: LocalScheduler,
  updater: DesktopUpdater,
): void {
  ipcMain.handle('schedules:list', (event) => {
    authorized(event);
    return scheduler.list();
  });
  ipcMain.handle('schedules:set', (event, projectId: unknown, config: unknown) => {
    authorized(event);
    return scheduler.set(id.parse(projectId), ScheduleConfigSchema.parse(config));
  });
  ipcMain.handle('app:get-version', (event) => {
    authorized(event);
    return app.getVersion();
  });
  ipcMain.handle('updates:get-status', (event) => {
    authorized(event);
    return updater.snapshot();
  });
  ipcMain.handle('updates:get-preferences', (event) => {
    authorized(event);
    return updater.getPreferences();
  });
  ipcMain.handle('updates:set-preferences', (event, preferences: unknown) => {
    authorized(event);
    return updater.setPreferences(
      z
        .object({ autoDownload: z.boolean(), channel: z.enum(['stable', 'beta']) })
        .strict()
        .parse(preferences),
    );
  });
  ipcMain.handle('updates:check', (event) => {
    authorized(event);
    return updater.check();
  });
  ipcMain.handle('updates:download', (event) => {
    authorized(event);
    return updater.download();
  });
  ipcMain.handle('updates:install', (event) => {
    authorized(event);
    return updater.install();
  });
}
/** Keep native file dialogs and export writes in the trusted main process. */
export function registerFileIpc(
  authorized: IpcAuthorization,
  window: BrowserWindow,
  worker: WorkerClient,
): void {
  ipcMain.handle('aiden:chooseProjectFolder', async (event) => {
    authorized(event);
    const r = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Choose project folder',
      buttonLabel: 'Use project folder',
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('aiden:chooseContext', async (event) => {
    authorized(event);
    const r = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Project context', extensions: ['md', 'txt'] }],
    });
    const selectedPath = r.filePaths[0];
    if (r.canceled || !selectedPath) return null;
    return readFile(selectedPath, 'utf8');
  });
  ipcMain.handle('aiden:openExternal', async (event, value: string) => {
    authorized(event);
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Only HTTPS links can be opened.');
    await shell.openExternal(url.href);
  });
  ipcMain.handle('aiden:export', async (event, input: unknown) => {
    authorized(event);
    const p = z
      .object({
        projectId: id,
        runId: id,
        format: z.enum(['json', 'markdown']),
        includeEstimates: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    const text = await worker.request('export', p);
    const r = await dialog.showSaveDialog(window, {
      defaultPath: `aiden-report.${p.format === 'json' ? 'json' : 'md'}`,
    });
    if (r.canceled || !r.filePath) return false;
    await writeFile(r.filePath, text, { mode: 0o600 });
    return true;
  });
}
