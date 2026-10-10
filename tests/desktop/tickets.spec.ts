import { expect, test } from '@playwright/test';

import { ticketFixture } from '../ticket-fixture.js';
import { createProject, desktopFixture, lookAgain } from './journey-fixture.js';

test('an existing plan can connect later, publish, and resync its linked tickets through MCP', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const tracker = await ticketFixture({ projects: true });
  tracker.linear.behavior.splitProjectIds = true;
  const fixture = await desktopFixture();
  const desktop = await fixture.launch(info);
  try {
    const { page, app } = desktop;
    await createProject(app, page, fixture.root);
    // Publishing lives in the Tickets pop-up, off the brief.
    await page.getByRole('button', { name: 'Tickets', exact: true }).click();
    await page.getByRole('button', { name: 'Connect tracker', exact: true }).click();
    await page.getByRole('button', { name: 'Manage tracker connections' }).click();
    await expect(page.getByRole('button', { name: 'Connect Linear', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Jira', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add server', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Jira and custom MCP are experimental/)).toBeVisible();
    await page.screenshot({
      path: info.outputPath('linear-only-integrations.png'),
      fullPage: true,
    });
    // Seed a synthetic Linear account through the real worker. New custom-server setup is hidden.
    await page.evaluate(
      async ({ url, token }) => {
        const connection = await window.aiden!.request('integrationAdd', {
          name: 'Synthetic tracker',
          provider: 'linear',
          url,
          auth: 'bearer',
          bearer: token,
          sessionOnly: true,
        });
        await window.aiden!.request('integrationConnect', { connectionId: connection.id });
      },
      { url: tracker.server.url, token: tracker.server.token },
    );
    // Reopening a disconnected connection must reuse its identity from the project flow.
    await page.evaluate(async () => {
      const connections = await window.aiden!.request('integrations');
      const tracker = connections.find((connection) => connection.name === 'Synthetic tracker')!;
      await window.aiden!.request('integrationDisconnect', { connectionId: tracker.id });
    });
    await page.reload();
    await page.getByRole('button', { name: 'A book project', exact: true }).first().click();
    await page.getByRole('button', { name: 'Tickets', exact: true }).click();
    const tickets = page.getByRole('dialog', { name: 'Tickets' });
    await page.getByRole('button', { name: 'Connect tracker', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'MCP connection' })
      .selectOption({ label: 'Synthetic tracker · Reconnect required' });
    await page.getByRole('button', { name: 'Reconnect Synthetic tracker' }).click();
    await expect(page.getByRole('combobox', { name: 'MCP connection' })).toContainText(
      'Synthetic tracker · Connected',
    );
    expect(
      await page.evaluate(async () => (await window.aiden!.request('integrations')).length),
    ).toBe(1);
    expect(tracker.linear.calls).not.toContain('teams');
    await page.getByRole('combobox', { name: 'Linear team' }).click();
    await expect(page.getByRole('option', { name: 'Books', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('linear-team-picker.png'), fullPage: true });
    await page.getByRole('option', { name: 'Books', exact: true }).click();
    await expect(page.getByText('New Linear project: A book project')).toBeVisible();
    await page.getByRole('checkbox', { name: /Automatically create/ }).check();
    await page.getByRole('button', { name: 'Create project and publish tickets' }).click();
    await expect(
      page.getByText('Ticket settings saved. Aiden will create and check tickets automatically.'),
    ).toBeVisible();
    expect(tracker.issues.size).toBe(1);
    expect(tracker.linear.projects.size).toBe(1);
    expect(tracker.linear.projects.get('project-1')?.name).toBe('A book project');
    expect(tracker.issues.get('issue-1')?.project).toBe(
      tracker.linear.projects.get('project-1')?.uuid,
    );
    expect(tracker.issues.get('issue-1')?.team).toBe('team-books');
    expect(tracker.calls).toEqual(['search', 'create', 'get']);
    await page.screenshot({
      path: info.outputPath('automatic-ticket-settings.png'),
      fullPage: true,
    });
    await expect(
      page.getByRole('link', { name: 'Open Linear project: A book project' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Publishing settings', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Linear team' })).toContainText('Books');
    await expect(page.getByText('Linked Linear project: A book project')).toBeVisible();
    await page.getByRole('button', { name: 'Close publishing settings', exact: true }).click();
    await tickets.getByRole('button', { name: 'Close tickets' }).click();
    await expect(tickets).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tickets · Linear', exact: true })).toBeVisible();
    /** The first requirement's pop-up, where its ticket and tracker state are shown. */
    const sheet = page.getByRole('dialog', { name: 'Requirement REQ-1' });
    const openSheet = async () => {
      await page.locator('.req-row .req-open').first().click();
      await expect(sheet).toBeVisible();
    };
    const closeSheet = async () => {
      await sheet.getByRole('button', { name: 'Close requirement REQ-1' }).click();
      await expect(sheet).toHaveCount(0);
    };
    /** Sync inside the Tickets pop-up, then close it so the brief is readable again. */
    const sync = async () => {
      await page.getByRole('button', { name: 'Tickets · Linear', exact: true }).click();
      await tickets.getByRole('button', { name: 'Sync tickets', exact: true }).click();
      await expect(tickets.getByText(/Last synced/)).toBeVisible();
      await tickets.getByRole('button', { name: 'Close tickets' }).click();
      await expect(tickets).toHaveCount(0);
    };
    await page.locator('.feature-summary').first().click();
    await openSheet();
    await expect(sheet.getByText('Delivery ticket · F-1 · Published')).toBeVisible();
    await expect(sheet.getByText(/Tracker: Todo/)).toBeVisible();
    await expect(sheet.getByText(/Tracker status is not acceptance evidence/)).toBeVisible();
    await closeSheet();
    tracker.issues.get('issue-1')!.status = 'In Progress';
    await sync();
    await openSheet();
    await expect(sheet.getByText(/Tracker: In Progress/)).toBeVisible();
    await closeSheet();
    expect(tracker.issues.size).toBe(1);
    expect(tracker.calls.filter((call) => call === 'create')).toHaveLength(1);
    expect(tracker.linear.calls.filter((call) => call === 'create')).toHaveLength(1);
    tracker.issues.get('issue-1')!.status = 'Done';
    tracker.issues.get('issue-1')!.statusType = 'completed';
    await sync();
    await openSheet();
    await expect(sheet.getByText(/Tracker: Done/)).toBeVisible();
    await closeSheet();
    await expect(page.getByRole('region', { name: 'Delivery attention' })).toContainText(
      'Checking completion',
    );
    await lookAgain(page);
    const attention = page.getByRole('region', { name: 'Delivery attention' });
    await expect(attention.getByText('Delivery deviation')).toHaveAttribute(
      'title',
      /is marked Done, but its requirements are incomplete/,
    );
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await page.locator('.feature-summary').first().click();
    await expect(page.locator('.feature-summary').first()).toContainText('Delivery deviation');
    await page.setViewportSize({ width: 950, height: 760 });
    await attention.scrollIntoViewIfNeeded();
    await expect(attention).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('delivery-deviation-overview.png'),
      fullPage: true,
    });
    // The finding's line opens the affected requirement with the full story.
    await attention.locator('.attention-open').first().click();
    await expect(sheet.getByRole('region', { name: 'Delivery attention' })).toContainText(
      'is marked Done, but its requirements are incomplete',
    );
    await closeSheet();
    // A human edit remains a conflict, and retry never overwrites it or makes another issue.
    tracker.issues.get('issue-1')!.description += '\nHuman note';
    await sync();
    await expect(page.getByText(/1 ticket\(s\) need attention/)).toBeVisible();
    expect(tracker.issues.get('issue-1')!.description).toContain('Human note');
    expect(tracker.issues.size).toBe(1);
    await page.screenshot({ path: info.outputPath('automatic-ticket-plan.png'), fullPage: true });
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
    await tracker.close();
  }
});
