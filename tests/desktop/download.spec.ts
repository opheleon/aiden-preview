import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { downloadFixture } from './download-fixture.js';
import { createProject, desktopFixture } from './journey-fixture.js';

test('background update check downloads automatically, rejects corrupt bytes, and recovers without unhandled rejections', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  const desktop = await fixture.launch(info, { HOME: fixture.root, AIDEN_FORCE_DEV_UPDATES: '1' });
  let download: Awaited<ReturnType<typeof downloadFixture>> | undefined;
  try {
    download = await downloadFixture(desktop.app, fixture.root);
    await expect
      .poll(() => desktop.page.evaluate(() => window.aiden!.getUpdatePreferences()))
      .toEqual({ autoDownload: true, channel: 'stable' });
    // Do not click Check or Download: the real 30-second startup timer must initiate both.
    await expect
      .poll(
        async () => (await desktop.page.evaluate(() => window.aiden!.getUpdateStatus())).state,
        { timeout: 45_000 },
      )
      .toBe('error');
    expect(download.requests.some((url) => url.includes('synthetic-arm64.zip'))).toBe(true);
    download.setCorrupt(false);
    await desktop.page.evaluate(() => window.aiden!.checkForUpdates());
    await expect
      .poll(async () => (await desktop.page.evaluate(() => window.aiden!.getUpdateStatus())).state)
      .toBe('downloaded');
    await download.verify(1);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
    await download?.close();
  }
});

test('automatic download opt-out is preserved and enabling it downloads the already offered update', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  const preferences = path.join(fixture.root, 'desktop-data', 'preferences');
  await mkdir(preferences, { recursive: true });
  await writeFile(
    path.join(preferences, 'updates.json'),
    JSON.stringify({ autoDownload: false, channel: 'stable' }),
  );
  const desktop = await fixture.launch(info, { HOME: fixture.root, AIDEN_FORCE_DEV_UPDATES: '1' });
  let download: Awaited<ReturnType<typeof downloadFixture>> | undefined;
  try {
    download = await downloadFixture(desktop.app, fixture.root);
    download.setCorrupt(false);
    await desktop.page.evaluate(() => window.aiden!.checkForUpdates());
    await expect
      .poll(async () => (await desktop.page.evaluate(() => window.aiden!.getUpdateStatus())).state)
      .toBe('available');
    expect(download.requests.some((url) => url.includes('synthetic-arm64.zip'))).toBe(false);
    await desktop.page.evaluate(() =>
      window.aiden!.setUpdatePreferences({ autoDownload: true, channel: 'stable' }),
    );
    await expect
      .poll(async () => (await desktop.page.evaluate(() => window.aiden!.getUpdateStatus())).state)
      .toBe('downloaded');
    await download.verify();
  } finally {
    await desktop.close();
    await download?.close();
  }
});

test('sidebar offers download and explicit restart from the project without opening settings', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  const preferences = path.join(fixture.root, 'desktop-data', 'preferences');
  await mkdir(preferences, { recursive: true });
  await writeFile(
    path.join(preferences, 'updates.json'),
    JSON.stringify({ autoDownload: false, channel: 'stable' }),
  );
  const desktop = await fixture.launch(info, { HOME: fixture.root, AIDEN_FORCE_DEV_UPDATES: '1' });
  let download: Awaited<ReturnType<typeof downloadFixture>> | undefined;
  try {
    download = await downloadFixture(desktop.app, fixture.root);
    download.setCorrupt(false);
    await createProject(desktop.app, desktop.page, fixture.root);
    const update = desktop.page.getByRole('region', { name: 'App update', exact: true });
    await update.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(
      update.getByRole('button', { name: 'Download update', exact: true }),
    ).toBeVisible();
    await desktop.page.screenshot({
      path: info.outputPath('sidebar-update-available.png'),
      fullPage: true,
    });
    await desktop.page
      .locator('.sidebar-bottom')
      .screenshot({ path: info.outputPath('sidebar-update-control.png') });
    await update.getByRole('button', { name: 'Download update', exact: true }).click();
    await expect(
      update.getByRole('button', { name: 'Restart to update', exact: true }),
    ).toBeEnabled();
    await expect(desktop.page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
    await desktop.page.screenshot({
      path: info.outputPath('sidebar-update-ready.png'),
      fullPage: true,
    });
    await download.verify();
    // Observe explicit installation intent without invoking the native installer or restarting.
    await desktop.app.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(`${app.getAppPath()}/package.json`);
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      Object.assign(globalThis, { sidebarInstallCalls: 0 });
      autoUpdater.quitAndInstall = () => {
        const state = globalThis as typeof globalThis & { sidebarInstallCalls: number };
        state.sidebarInstallCalls++;
      };
    });
    await update.getByRole('button', { name: 'Restart to update', exact: true }).click();
    await expect
      .poll(() =>
        desktop.app.evaluate(
          () =>
            (globalThis as typeof globalThis & { sidebarInstallCalls: number }).sidebarInstallCalls,
        ),
      )
      .toBe(1);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
    await download?.close();
  }
});
