import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { downloadFixture } from './download-fixture.js';
import { desktopFixture } from './journey-fixture.js';

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
