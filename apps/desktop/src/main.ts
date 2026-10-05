import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog } from 'electron';

import type { RunEvent } from '../../../packages/contracts/src/index.js';
import { WorkerClient } from '../../../packages/core/src/client.js';
import { registerFileIpc, registerPreferenceIpc } from './desktop-ipc.js';
import { LocalDiagnostics } from './diagnostics.js';
import { registerFirstUseIpc } from './first-use-ipc.js';
import { DesktopUpdater } from './updater.js';
import { ProjectWatcher } from './watcher.js';
import { registerWorkerIpc } from './worker-ipc.js';
// Electron otherwise names the macOS app menu after package.json's npm name.
app.setName('Aiden');
const dataRoot = process.env.AIDEN_HOME || path.join(app.getPath('home'), '.aiden');
const diagnostics = new LocalDiagnostics(dataRoot);
mkdirSync(path.join(dataRoot, 'desktop'), { recursive: true, mode: 0o700 });
app.setPath('userData', path.join(dataRoot, 'desktop'));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    window.restore();
    window.focus();
  }
});
let watcher: ProjectWatcher;
const here = path.dirname(fileURLToPath(import.meta.url));
let worker: WorkerClient;
let window: BrowserWindow;
let updater: DesktopUpdater;
let quitting = false;
const activeRuns = new Set<string>();
const activeCodingJobs = new Set<string>();
/** Connect lifecycle observers before loading renderer content; failures never relaunch paid work. */
function observeDesktop(): void {
  worker.on('event', (event: RunEvent) => {
    if (event.type === 'coding') {
      if (event.codingActive) activeCodingJobs.add(event.runId);
      else activeCodingJobs.delete(event.runId);
    }
    if (event.type === 'progress' || event.type === 'activity') activeRuns.add(event.runId);
    if (['review', 'completed', 'failed', 'cancelled'].includes(event.type)) {
      activeRuns.delete(event.runId);
    }
    if (!window.isDestroyed()) window.webContents.send('aiden:event', event);
  });
  worker.on('workerStopped', () => {
    if (!quitting) void diagnostics.record({ component: 'worker', code: 'worker_stopped' });
    watcher.stop();
    if (!window.isDestroyed())
      window.webContents.send('aiden:event', {
        type: 'failed',
        runId: 'worker',
        message: 'The worker stopped. Reopen Aiden to resume saved work.',
      });
  });
  window.webContents.on('render-process-gone', () => {
    if (!quitting) void diagnostics.record({ component: 'renderer', code: 'renderer_crashed' });
  });
  window.webContents.on('unresponsive', () => {
    void diagnostics.record({ component: 'renderer', code: 'renderer_unresponsive' });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}
app
  .whenReady()
  .then(async () => {
    if (!ownsInstance) return;
    // Packaged builds take the icon from the app bundle; development shows the same one in the Dock.
    const devIcon = path.resolve(here, '../../../../build/app-icon.png');
    if (process.platform === 'darwin' && !app.isPackaged && existsSync(devIcon))
      app.dock?.setIcon(devIcon);
    worker = new WorkerClient({
      ...process.env,
      AIDEN_HOME: dataRoot,
    });
    window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 950,
      minHeight: 680,
      title: 'Aiden',
      backgroundColor: '#F6F4EE',
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    /** Accept requests only from this window’s main frame, excluding embedded or foreign content. */
    const authorized = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error('Untrusted IPC sender.');
    };
    watcher = new ProjectWatcher({
      dataRoot,
      worker,
      isBusy: () => activeRuns.size > 0 || activeCodingJobs.size > 0,
      onError: () => void diagnostics.record({ component: 'watcher', code: 'check_failed' }),
    });
    updater = new DesktopUpdater({
      dataRoot,
      isRunActive: () => activeRuns.size > 0 || activeCodingJobs.size > 0,
    });
    registerPreferenceIpc(authorized, updater);
    registerFirstUseIpc(authorized, dataRoot);
    registerWorkerIpc(authorized, worker);
    registerFileIpc(authorized, window, worker);
    observeDesktop();
    await watcher.start();
    await window.loadFile(path.resolve(here, '../../../desktop/index.html'));
    await updater.start();
  })
  .catch(async () => {
    await diagnostics.record({ component: 'startup', code: 'startup_failed' });
    dialog.showErrorBox(
      'Aiden could not start',
      'Startup was interrupted. Quit and reopen Aiden. Saved projects and checkpoints have been preserved; analysis will not restart automatically.',
    );
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  watcher?.stop();
  updater?.dispose();
  worker?.close();
});
