import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { desktopFixture } from './journey-fixture.js';

test('requirements progress stays compact, animated, and cancellable at both window sizes', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  await writeFile(fixture.control, JSON.stringify({ pauseUnderstand: true }));
  const desktop = await fixture.launch(info);
  try {
    const { page } = desktop;
    await page.getByLabel('What are you building?').fill('Users can list and create books.');
    await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
    const chat = page.getByRole('dialog', { name: 'Chat with Aiden' });
    const status = chat.getByRole('status', { name: 'Project work in progress' });
    await expect(status).toHaveText('Writing requirements');
    await expect.poll(async () => (await fixture.calls()).includes('understand')).toBe(true);
    await expect(chat.getByText('Understand...')).toHaveCount(0);
    await expect(chat.getByText('Reading your goal to write the requirements.')).toHaveCount(0);
    await expect(status.locator('span')).toHaveCSS('animation-name', 'guide-thinking-shimmer');
    for (const width of [1320, 600]) {
      await page.setViewportSize({ width, height: 868 });
      const label = await status.boundingBox();
      const stop = await chat.getByRole('button', { name: 'Stop', exact: true }).boundingBox();
      expect(Math.abs(label!.y + label!.height / 2 - stop!.y - stop!.height / 2)).toBeLessThan(2);
      expect(stop!.x - label!.x - label!.width).toBeLessThanOrEqual(16);
      expect(await chat.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`requirements-progress-${width}.png`) });
    }
    await chat.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(status).toHaveCount(0);
    await expect(chat.getByText(/Writing requirements stopped/)).toBeVisible();
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});
