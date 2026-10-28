import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, powerMonitor } from 'electron';

import { appFlavor } from '../../../packages/contracts/src/app-flavor.js';
import type { RunEvent } from '../../../packages/contracts/src/index.js';
import { AccountPoller } from '../../../packages/core/src/accounts/poller.js';
import { WorkerClient } from '../../../packages/core/src/client.js';
import { ActiveWork } from './active-work.js';
import { BackgroundMode, registerBackgroundIpc } from './background.js';
import { registerFileIpc, registerPreferenceIpc } from './desktop-ipc.js';
import { LocalDiagnostics } from './diagnostics.js';
import { registerFirstUseIpc } from './first-use-ipc.js';
import { DesktopUpdater } from './updater.js';
import { ProjectWatcher } from './watcher.js';
import { registerWorkerIpc } from './worker-ipc.js';
// Aiden Beta is its own app: its own name, data folder, sign-in, servers, and update feed. The
// worker inherits AIDEN_FLAVOR, which selects the beta Teams server, tenant, and keychain entries.
const flavor = appFlavor(app.getVersion(), app.isPackaged);
process.env.AIDEN_FLAVOR = flavor;
const appName = flavor === 'beta' ? 'Aiden Beta' : 'Aiden';
// Electron otherwise names the macOS app menu after package.json's npm name.
app.setName(appName);
// Automated verification renders normally without presenting or activating a native window.
const headless = process.env.AIDEN_HEADLESS === '1';
if (headless && process.platform === 'darwin') app.setActivationPolicy('prohibited');
const dataRoot =
  process.env.AIDEN_HOME ||
  path.join(app.getPath('home'), flavor === 'beta' ? '.aiden-beta' : '.aiden');
const diagnostics = new LocalDiagnostics(dataRoot);
mkdirSync(path.join(dataRoot, 'desktop'), { recursive: true, mode: 0o700 });
app.setPath('userData', path.join(dataRoot, 'desktop'));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
// Started by the login item: no window until Aiden knows whether it should stay in the tray.
const atLogin = !headless && BackgroundMode.launchedAtLogin();
app.on('second-instance', () => {
  if (!headless) background?.show();
});
// macOS: opening Aiden again from Finder or the Dock brings back a window hidden in the menu bar.
app.on('activate', () => {
  if (!headless) background?.show();
});
let watcher: ProjectWatcher;
let poller: AccountPoller;
const here = path.dirname(fileURLToPath(import.meta.url));
let worker: WorkerClient;
let window: BrowserWindow;
let updater: DesktopUpdater;
let background: BackgroundMode | undefined;
let quitting = false;
let quitReady = false;
// Busy comes from what the worker is running, never from bookkeeping of its run events.
let activeWork: ActiveWork;
/** Connect lifecycle observers before loading renderer content; failures never relaunch paid work. */
function observeDesktop(): void {
  worker.on('event', (event: RunEvent) => {
    void activeWork.refresh();
    if (!window.isDestroyed()) window.webContents.send('aiden:event', event);
  });
  // A run announces it finished before it is gone; read again once the worker says it is.
  worker.on('activeWork', () => void activeWork.refresh());
  worker.on('workerStopped', () => {
    if (quitting) return;
    void diagnostics.record({ component: 'worker', code: 'worker_stopped' });
    watcher.stop();
    poller.stop();
    activeWork.stop();
    // Bring a window hidden in the tray back, so the person sees that work stopped.
    background?.show();
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
    // Packaged builds take the icon from the app bundle; development shows the LOCAL-badged one
    // in the Dock so it is never mistaken for an installed Aiden or Aiden Beta.
    const devIcon = path.resolve(here, '../../../../build/app-icon-local.png');
    if (process.platform === 'darwin' && !app.isPackaged && existsSync(devIcon))
      app.dock?.setIcon(devIcon);
    worker = new WorkerClient({
      ...process.env,
      AIDEN_HOME: dataRoot,
      AIDEN_PACKAGED: app.isPackaged ? '1' : '0',
      AIDEN_APP_VERSION: app.getVersion(),
      ...(app.isPackaged
        ? {
            PLAYWRIGHT_BROWSERS_PATH: path.join(process.resourcesPath, 'playwright'),
            AIDEN_NATIVE_PATH: path.join(process.resourcesPath, 'native'),
          }
        : {}),
    });
    window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 950,
      minHeight: 680,
      title: appName,
      show: !headless && !atLogin,
      focusable: !headless,
      skipTaskbar: headless,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#F6F4EE',
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: !headless,
      },
    });
    /** Accept requests only from this window’s main frame, excluding embedded or foreign content. */
    const authorized = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error('Untrusted IPC sender.');
    };
    activeWork = new ActiveWork(worker);
    watcher = new ProjectWatcher({
      dataRoot,
      worker,
      isBusy: () => activeWork.isBusy(),
      onError: () => void diagnostics.record({ component: 'watcher', code: 'check_failed' }),
    });
    poller = new AccountPoller({
      worker,
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      onBattery: () => powerMonitor.isOnBatteryPower(),
    });
    updater = new DesktopUpdater({
      dataRoot,
      isRunActive: () => activeWork.isBusy(),
    });
    registerPreferenceIpc(authorized, updater, () => activeWork.refresh());
    registerFirstUseIpc(authorized, dataRoot);
    registerWorkerIpc(authorized, worker, () => poller.nudge());
    registerFileIpc(authorized, window, worker);
    registerBackgroundIpc(authorized, dataRoot);
    observeDesktop();
    activeWork.start();
    if (!headless) {
      background = new BackgroundMode({
        dataRoot,
        window,
        worker,
        isQuitting: () => quitting,
        iconPath: path.resolve(here, '../../../icons/app-icon.png'),
      });
      await background.start();
    }
    await watcher.start();
    poller.start();
    await window.loadFile(path.resolve(here, '../../../desktop/index.html'));
    if (atLogin) await background?.leave();
    await updater.start();
  })
  .catch(async () => {
    await diagnostics.record({ component: 'startup', code: 'startup_failed' });
    if (!headless)
      dialog.showErrorBox(
        'Aiden could not start',
        'Startup was interrupted. Quit and reopen Aiden. Saved projects and checkpoints have been preserved; analysis will not restart automatically.',
      );
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitReady) return;
  if (worker) event.preventDefault();
  if (quitting) return;
  quitting = true;
  watcher?.stop();
  poller?.stop();
  activeWork?.stop();
  updater?.dispose();
  background?.dispose();
  if (worker) {
    void worker.close().then(() => {
      quitReady = true;
      app.quit();
    });
  }
});
