import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { desktopFixture } from './journey-fixture.js';

/** Navigate the public guide controls; only Got it writes completion. */
async function confirmGuide(page: Page) {
  while (await page.getByRole('button', { name: 'Next', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
}

test('first use returns after dismissal, persists confirmation across restart, and keeps focus and controls usable', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const f = await desktopFixture();
  const file = path.join(f.f.root, 'desktop-data/preferences/first-use.json');
  let running = await f.launch(info, {}, true);
  try {
    await expect(running.page.getByRole('dialog', { name: 'Meet Aiden' })).toBeVisible();
    await expect(running.page.getByRole('heading', { name: 'Meet Aiden' })).toBeFocused();
    await expect(running.page.getByText(/Step 1 of/)).toBeVisible();
    await running.page.keyboard.press('Tab');
    expect(await running.page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(
      true,
    );
    await running.page.keyboard.press('Escape');
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await running.close();
    running = await f.launch(info, {}, true);
    await expect(running.page.getByRole('dialog')).toBeVisible();
    await running.page.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    await running.close();
    running = await f.launch(info, {}, true);
    await running.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(360, 480);
      window.setContentSize(390, 560);
    });
    await expect(running.page.getByRole('dialog')).toBeVisible();
    await running.page.screenshot({ path: info.outputPath('guide-small.png') });
    expect(
      await running.page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await confirmGuide(running.page);
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    const completed = await readFile(file, 'utf8');
    expect(JSON.parse(completed).completedAt).toBeTruthy();
    await running.page.reload();
    await running.page.locator('[data-guide-ready="true"]').waitFor();
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    await running.close();
    running = await f.launch(info, {}, true);
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    expect(await readFile(file, 'utf8')).toBe(completed);
    expect(running.errors).toEqual([]);
  } finally {
    await running.close();
  }
});

test('corrupt preferences and a failed completion write recover without falsely completing', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const f = await desktopFixture();
  const file = path.join(f.f.root, 'desktop-data/preferences/first-use.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{');
  const running = await f.launch(info, {}, true);
  try {
    await expect(running.page.getByRole('status')).toContainText(
      'saved guide preference could not be read',
    );
    await rm(file);
    await mkdir(file);
    await confirmGuide(running.page);
    await expect(running.page.getByRole('alert')).toContainText(
      'Could not save your guide confirmation',
    );
    await expect(running.page.getByRole('dialog')).toBeVisible();
    await rm(file, { recursive: true });
    await running.page.getByRole('button', { name: 'Got it' }).click();
    await expect(running.page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.parse(await readFile(file, 'utf8')).completedAt).toBeTruthy();
  } finally {
    await running.close();
  }
});
