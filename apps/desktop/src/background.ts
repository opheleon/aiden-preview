import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  app,
  autoUpdater,
  type BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  Tray,
} from 'electron';
import { z } from 'zod/v3';

import type { WorkerClient } from '../../../packages/core/src/client.js';
import {
  autostartEntry,
  autostartFile,
  backgroundFlag,
  launchedInBackground,
  readBackgroundPreferences,
  saveBackgroundPreferences,
} from './background-preferences.js';
import type { IpcAuthorization } from './desktop-ipc.js';

/** How long closing waits to learn the Teams state before keeping Aiden running anyway. */
const statusWaitMs = 5_000;

/** What Settings shows for background running. */
export interface BackgroundSettings {
  openAtLogin: boolean;
  /** Login items exist only for the installed app. */
  available: boolean;
}

/**
 * Keeps Aiden running in the tray (the menu bar on macOS) after its window closes, but only
 * while this machine is signed in to Teams with pickup on, so team work continues. Otherwise
 * closing quits as before. It also starts Aiden at login, hidden, when that setting is on.
 */
export class BackgroundMode {
  private tray: Tray | undefined;
  private updating = false;

  /**
   * Bind the window and worker without changing either.
   * @param options Background dependencies.
   * @param options.dataRoot Aiden data folder holding the preferences.
   * @param options.window The main window.
   * @param options.worker Answers whether this machine picks up team work.
   * @param options.isQuitting Whether a real quit is under way, so closing must not be stopped.
   * @param options.iconPath Image for the tray icon.
   */
  constructor(
    private readonly options: {
      dataRoot: string;
      window: BrowserWindow;
      worker: Pick<WorkerClient, 'request'>;
      isQuitting: () => boolean;
      iconPath: string;
    },
  ) {}

  /** Whether the login item started this launch. */
  static launchedAtLogin(): boolean {
    return (
      launchedInBackground(process.argv) ||
      (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
    );
  }

  /** Intercept the close button and keep the login item in step with the saved preference. */
  async start(): Promise<void> {
    // Installing an update closes windows before the quit begins; never hold one open then.
    autoUpdater.on('before-quit-for-update', () => (this.updating = true));
    this.options.window.on('close', (event) => {
      if (this.options.isQuitting() || this.updating) return;
      event.preventDefault();
      void this.leave();
    });
    if (app.isPackaged)
      await applyLoginItem((await readBackgroundPreferences(this.options.dataRoot)).openAtLogin);
  }

  /** Go to the tray while signed in to Teams with pickup on; otherwise quit. */
  async leave(): Promise<void> {
    if (await this.picksUpTeamWork()) await this.hide();
    else app.quit();
  }

  /** Signed in with pickup on; a slow account check keeps Aiden running, a stopped worker does not. */
  private async picksUpTeamWork(): Promise<boolean> {
    const slow = Symbol('slow');
    const status = await Promise.race([
      this.options.worker.request('accountStatus'),
      new Promise<typeof slow>((resolve) => setTimeout(() => resolve(slow), statusWaitMs)),
    ]).catch(() => null);
    if (status === slow) return true;
    return !!status && status.signedIn && status.pickupEnabled;
  }

  /** Hide the window and the Dock icon, show the tray icon, and explain it once. */
  private async hide(): Promise<void> {
    this.options.window.hide();
    if (process.platform === 'darwin') app.dock?.hide();
    this.ensureTray();
    const preferences = await readBackgroundPreferences(this.options.dataRoot);
    if (preferences.noticeShown || !Notification.isSupported()) return;
    const name = app.getName();
    new Notification({
      title: `${name} is still running`,
      body: `It keeps picking up team work. Open or quit ${name} from its icon in the tray or menu bar.`,
    }).show();
    await saveBackgroundPreferences(this.options.dataRoot, { noticeShown: true });
  }

  /** Bring the window back from the tray, or forward from behind other windows. */
  show(): void {
    const { window } = this.options;
    if (window.isDestroyed()) return;
    if (process.platform === 'darwin') void app.dock?.show();
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
    this.tray?.destroy();
    this.tray = undefined;
  }

  /** Create the tray icon with Open and Quit. */
  private ensureTray(): void {
    if (this.tray && !this.tray.isDestroyed()) return;
    const size = process.platform === 'darwin' ? 18 : 32;
    const icon = nativeImage.createFromPath(this.options.iconPath).resize({ width: size });
    this.tray = new Tray(icon);
    // The app's name is Aiden or Aiden Beta, so two installed apps stay distinguishable.
    const name = app.getName();
    this.tray.setToolTip(`${name} is picking up team work`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${name}`, click: () => this.show() },
        { type: 'separator' },
        { label: `Quit ${name}`, click: () => app.quit() },
      ]),
    );
    // macOS opens the menu on click; Windows and Linux open the window.
    if (process.platform !== 'darwin') this.tray.on('click', () => this.show());
  }

  /** Remove the tray icon before quitting. */
  dispose(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}

/**
 * Register or remove the login item. macOS and Windows use Electron's login item with the
 * background flag; Linux has no such API, so Aiden writes or removes an XDG autostart entry.
 */
async function applyLoginItem(openAtLogin: boolean): Promise<void> {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin, args: [backgroundFlag] });
    return;
  }
  const file = autostartFile();
  if (!openAtLogin) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, autostartEntry(process.env.APPIMAGE || process.execPath), { mode: 0o644 });
}

/** Register the Settings operations for background running. */
export function registerBackgroundIpc(authorized: IpcAuthorization, dataRoot: string): void {
  /** The settings view of the saved preferences. */
  const settings = async (): Promise<BackgroundSettings> => ({
    openAtLogin: (await readBackgroundPreferences(dataRoot)).openAtLogin,
    available: app.isPackaged,
  });
  ipcMain.handle('background:get-settings', async (event) => {
    authorized(event);
    return settings();
  });
  ipcMain.handle('background:set-settings', async (event, input: unknown) => {
    authorized(event);
    const { openAtLogin } = z.object({ openAtLogin: z.boolean() }).strict().parse(input);
    if (!app.isPackaged) throw new Error('Opening at login works only in the installed app.');
    await saveBackgroundPreferences(dataRoot, { openAtLogin });
    await applyLoginItem(openAtLogin);
    return settings();
  });
}
