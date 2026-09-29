import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod/v3';

import { id, type VerificationResult } from '../../../packages/contracts/src/index.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import { type LocalScheduler, ScheduleConfigSchema } from './scheduler.js';
import type { DesktopUpdater } from './updater.js';
/** Media types for browser check recordings and screenshots; any other file is refused. */
const mediaTypes: Record<string, string> = {
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
/** Recordings are a few megabytes; a much larger file is not one Aiden wrote. */
const maxMediaBytes = 200 * 1024 * 1024;

/** List every recording and screenshot a saved browser check names, relative to its folder. */
function mediaFiles(result: VerificationResult): Set<string> {
  const files = new Set<string>();
  for (const criterion of result.criteria)
    for (const attempt of criterion.attempts) {
      files.add(attempt.video);
      if (attempt.proof) files.add(attempt.proof.screenshot);
      for (const step of attempt.steps) if (step.screenshot) files.add(step.screenshot);
    }
  return files;
}

/** Read one recording the worker's saved result names, from inside that run's own folder. */
async function readVerificationMedia(
  worker: WorkerClient,
  input: unknown,
): Promise<{ type: string; data: ArrayBuffer }> {
  const p = z
    .object({ projectId: id, runId: id, file: z.string().min(1).max(500) })
    .strict()
    .parse(input);
  const saved = await worker.request('verification', { projectId: p.projectId, runId: p.runId });
  if (!saved || !mediaFiles(saved.result).has(p.file))
    throw new Error('This recording is not part of the browser check.');
  const folder = path.dirname(saved.reportPath);
  const file = path.resolve(folder, p.file);
  const type = mediaTypes[path.extname(file).toLowerCase()];
  const relative = path.relative(folder, file);
  if (!type || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('This recording is not part of the browser check.');
  if ((await stat(file)).size > maxMediaBytes) throw new Error('This recording is too large.');
  const bytes = await readFile(file);
  return { type, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

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
  ipcMain.handle('aiden:openVerificationReport', async (event, input: unknown) => {
    authorized(event);
    const p = z.object({ projectId: id, runId: id }).strict().parse(input);
    // Only the worker's own report path is opened; the renderer never supplies a file path.
    const saved = await worker.request('verification', p);
    if (!saved) throw new Error('This browser check has no saved report.');
    const failure = await shell.openPath(saved.reportPath);
    if (failure) throw new Error(`Could not open the report: ${failure}`);
  });
  ipcMain.handle('aiden:verificationMedia', (event, input: unknown) => {
    authorized(event);
    return readVerificationMedia(worker, input);
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
