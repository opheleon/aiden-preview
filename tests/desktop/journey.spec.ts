import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { ReportSchema } from '../../packages/contracts/src/index.js';
import { createProject, desktopFixture, lookAgain } from './journey-fixture.js';

const stoppedNote = /latest check didn't finish, so this is from the one before/;

test('one handoff produces a brief with evidence, exports, restart, cancellation, and fresh checks', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  let desktop = await fixture.launch(info);
  try {
    await createProject(desktop.app, desktop.page, fixture.root);
    let { page, app } = desktop;
    const project = 'A book project';
    await page.screenshot({ path: info.outputPath('delivery-plan.png'), fullPage: true });
    const initialCalls = await fixture.calls();
    // One handoff plans, checks, and sizes the work automatically.
    expect(initialCalls.slice(0, 3)).toEqual(['understand', 'assess', 'summary']);
    await expect
      .poll(async () => (await fixture.calls()).includes('estimate-remaining'))
      .toBe(true);
    // Local verification belongs to the coding agent; Aiden never asks for localhost.
    await expect(page.getByText('Tell Aiden where your app runs')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Claude Code' })).toHaveCount(0);
    await page.locator('.feature-summary').first().click();
    await page.locator('.req-row .req-open').first().click();
    const sheet = page.getByRole('dialog', { name: 'Requirement REQ-1' });
    await expect(sheet.getByText('Delivery ticket · F-1 · Not published')).toBeVisible();
    await sheet.getByRole('button', { name: 'Close requirement REQ-1' }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
      'Wrote 2 requirements',
    );
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.locator('.req-row .req-open').first().click();
    await sheet
      .getByRole('button', { name: /app.txt:1/ })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Code evidence' })).toContainText('GET /books');
    await page.getByRole('button', { name: 'Close evidence' }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close requirement REQ-1' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    const jsonFile = path.join(fixture.root, 'export.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, jsonFile);
    await page.getByLabel('More').click();
    await page.getByRole('menuitem', { name: 'Export JSON' }).click();
    await page.getByText('JSON report exported.').waitFor();
    const report = ReportSchema.parse(JSON.parse(await readFile(jsonFile, 'utf8')));
    expect(report.summary).toContain('FIXTURE REPORT');
    expect(report.assessments[0]!.evidence).toHaveLength(2);
    const markdown = path.join(fixture.root, 'export.md');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, markdown);
    await page.getByLabel('More').click();
    await page.getByRole('menuitem', { name: 'Export Markdown' }).click();
    await page.getByText('Markdown report exported.').waitFor();
    const exported = await readFile(markdown, 'utf8');
    expect(exported).toContain('FIXTURE REPORT');
    expect(exported).not.toContain('## Estimation');
    expect(desktop.errors).toEqual([]);
    await desktop.close();
    desktop = await fixture.launch(info);
    ({ page, app } = desktop);
    await page.getByRole('button', { name: project, exact: true }).click();
    await page.getByRole('region', { name: 'Requirements' }).waitFor();
    expect(await fixture.calls()).toEqual(initialCalls);
    await writeFile(fixture.control, JSON.stringify({ pause: true }));
    await lookAgain(page);
    await expect
      .poll(async () => (await fixture.calls()).filter((stage) => stage === 'assess'))
      .toHaveLength(2);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByText(stoppedNote)).toBeVisible();
    const cancelledCalls = await fixture.calls();
    await desktop.close();
    desktop = await fixture.launch(info);
    ({ page } = desktop);
    await page.getByRole('button', { name: project, exact: true }).click();
    await page.getByRole('region', { name: 'Requirements' }).waitFor();
    await expect(page.getByText(stoppedNote)).toBeVisible();
    expect(await fixture.calls()).toEqual(cancelledCalls);
    await writeFile(fixture.control, '{}');
    await lookAgain(page);
    // The brief stays visible during the fresh look, so wait for the look itself.
    await expect
      .poll(async () => (await fixture.calls()).filter((stage) => stage === 'assess'))
      .toHaveLength(3);
    await expect(page.getByText(stoppedNote)).toHaveCount(0);
    // A fresh code check keeps the reviewed requirements without rewriting them.
    expect((await fixture.calls()).filter((stage) => stage === 'understand')).toHaveLength(1);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});

test('quitting during a look preserves the last brief and waits for an explicit new check', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  let desktop = await fixture.launch(info);
  try {
    await createProject(desktop.app, desktop.page, fixture.root);
    const accepted = await desktop.page.evaluate(async () => {
      const project = (await window.aiden!.request('projects', {}))[0]!;
      const state = await window.aiden!.request('state', { projectId: project.id });
      return {
        projectId: project.id,
        reportId: state.runs.find((run) => run.kind === 'report')!.id,
      };
    });
    await writeFile(fixture.control, JSON.stringify({ pause: true }));
    await lookAgain(desktop.page);
    await expect
      .poll(async () => (await fixture.calls()).filter((stage) => stage === 'assess'))
      .toHaveLength(2);
    const submitted = await fixture.calls();
    await desktop.close();
    desktop = await fixture.launch(info);
    await desktop.page.getByRole('button', { name: 'A book project', exact: true }).click();
    await desktop.page.getByRole('region', { name: 'Requirements' }).waitFor();
    expect(await fixture.calls()).toEqual(submitted);
    const recovered = await desktop.page.evaluate(
      async (projectId) => window.aiden!.request('state', { projectId }),
      accepted.projectId,
    );
    expect(recovered.runs.find((run) => run.id === accepted.reportId)?.status).toBe('completed');
    expect(
      recovered.runs.find((run) => run.kind === 'report' && run.id !== accepted.reportId)?.status,
    ).toBe('cancelled');
    await writeFile(fixture.control, '{}');
    await lookAgain(desktop.page);
    await expect
      .poll(async () => (await fixture.calls()).filter((stage) => stage === 'assess'))
      .toHaveLength(3);
    expect((await fixture.calls()).filter((stage) => stage === 'understand')).toHaveLength(1);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});

test('first launch with missing providers explains recovery and reconnects after CLI installation', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  const missing = path.join(fixture.root, 'new-codex-installation');
  const desktop = await fixture.launch(info, {
    AIDEN_CODEX_BINARY: missing,
    AIDEN_CLAUDE_BINARY: path.join(fixture.root, 'missing-claude'),
  });
  try {
    const { page } = desktop;
    await page.getByLabel('What are you building?').fill('Synthetic first-install recovery');
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Model', exact: true }).click();
    await expect(page.getByText(/Install the Codex CLI/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Codex' })).toBeDisabled();
    await page.getByRole('button', { name: 'Claude', exact: true }).click();
    await expect(page.getByTestId('claude-connection')).toContainText('runtime unavailable');
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await writeFile(missing, await readFile(fixture.binary), { mode: 0o755 });
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(
      page.getByText('Subscription credentials available', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Codex' })).toBeEnabled();
    await expect(page.getByText(/Install the Codex CLI/)).toHaveCount(0);
    expect(await fixture.calls()).toEqual([]);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});

test('blocking scope pauses assessment and sizing until answered, with a draft ticket and no agent dispatch', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  await writeFile(fixture.control, JSON.stringify({ clarification: true, blocking: true }));
  const desktop = await fixture.launch(info);
  try {
    const { page, app } = desktop;
    await createProject(app, page, fixture.root, true);
    await expect(page.getByText('Blocked by a decision')).toBeVisible();
    await expect(
      page.getByText('Delivery paused: resolve blocking decisions in Needs you.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Claude Code' })).toHaveCount(0);
    expect(await fixture.calls()).not.toContain('assess');
    expect(await fixture.calls()).not.toContain('estimate-original');
    await page.locator('.feature-summary').first().click();
    await page.locator('.req-row .req-open').first().click();
    const sheet = page.getByRole('dialog', { name: 'Requirement REQ-1' });
    await expect(sheet.getByText('Blocked ticket · F-1 · Not published')).toBeVisible();
    await expect(sheet.getByText(/Resolve decisions before implementation/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('blocked-ticket.png'), fullPage: true });
    await sheet.getByRole('button', { name: 'Close requirement REQ-1' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /^Runs/ }).click();
    const blockedRun = page.getByRole('button', { name: /Checked the code/ });
    await expect(blockedRun).toContainText('Blocked');
    await blockedRun.click();
    await expect(page.getByRole('region', { name: 'Waiting for information' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('blocked-run.png'), fullPage: true });
    await writeFile(fixture.control, '{}');
    await page
      .getByRole('textbox', { name: /Other answer/ })
      .fill('Only signed-in members may access the library.');
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await page.getByRole('button', { name: 'A book project', exact: true }).click();
    await expect(page.getByText(/estimated complexity points/)).toBeAttached();
    await page.getByText('Progress details and estimates', { exact: true }).click();
    await expect(page.getByText(/estimated complexity points/)).toBeVisible();
    expect(await fixture.calls()).toContain('assess');
    await expect(page.getByText('Blocked by a decision')).toHaveCount(0);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});
