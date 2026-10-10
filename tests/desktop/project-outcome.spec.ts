import { expect, test } from '@playwright/test';

import { createProject, desktopFixture } from './journey-fixture.js';

test('acceptance preserves progress; closing persists across restart and reopening restores monitoring', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const f = await desktopFixture();
  let desktop = await f.launch(info);
  try {
    await createProject(desktop.app, desktop.page, f.root);
    const page = desktop.page;
    const progress = await page.getByRole('progressbar').getAttribute('aria-valuenow');
    // Before any decision the outcome lives in the menu; afterwards the decision gets a card.
    await expect(page.getByRole('region', { name: 'Project outcome' })).toHaveCount(0);
    await page.getByLabel('More').click();
    await page.getByRole('menuitem', { name: 'Accept outcome' }).click();
    const dialog = page.getByRole('dialog', { name: 'Accept outcome' });
    await expect(
      dialog.getByRole('button', { name: 'Accept outcome', exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel('Acceptance note')
      .fill('Synthetic acceptance: remaining gaps reviewed outside Aiden.');
    await page.screenshot({ path: info.outputPath('accept-outcome.png') });
    await dialog.getByRole('button', { name: 'Accept outcome', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Project outcome' })).toContainText(
      'Manually accepted',
    );
    expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(progress);
    await page.getByRole('button', { name: 'Close project', exact: true }).click();
    await page.getByLabel('Closing note').fill('Delivery finished for this synthetic fixture.');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close project', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Reopen project' })).toBeVisible();
    await expect(page.locator('.closed-projects')).toContainText('A book project');
    await expect(page.getByRole('button', { name: 'Run check now' })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('closed-project.png') });
    await desktop.close();
    desktop = await f.launch(info);
    await desktop.page.getByText('Closed projects', { exact: true }).click();
    await desktop.page.getByRole('button', { name: 'A book project', exact: true }).click();
    await expect(desktop.page.getByRole('button', { name: 'Reopen project' })).toBeVisible();
    await desktop.page.getByText('Decision history', { exact: true }).click();
    await expect(desktop.page.getByRole('region', { name: 'Project outcome' })).toContainText(
      'Synthetic acceptance',
    );
    await desktop.page.getByRole('button', { name: 'Reopen project' }).click();
    await expect(
      desktop.page.getByRole('button', { name: 'Close project', exact: true }),
    ).toBeVisible();
    await expect(desktop.page.locator('.closed-projects')).toHaveCount(0);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});
