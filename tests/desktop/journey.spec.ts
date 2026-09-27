import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { ReportSchema } from '../../packages/contracts/src/index.js';
import { createProject, desktopFixture } from './journey-fixture.js';

test('local provider protocol completes analysis, evidence, exports, restart, cancellation, and explicit recovery', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  let desktop = await fixture.launch(info);
  try {
    await createProject(desktop.app, desktop.page, fixture.root);
    let { page, app } = desktop;
    const initialCalls = await fixture.calls();
    expect(initialCalls).toEqual([
      'understand',
      'discover',
      'assess',
      'summary',
      'estimate-original',
      'estimate-remaining',
    ]);
    await page.getByText('Code evidence', { exact: true }).first().click();
    await page
      .getByRole('button', { name: /app.txt:1/ })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Code evidence' })).toContainText('GET /books');
    await page.getByRole('button', { name: 'Close evidence' }).click();
    const jsonFile = path.join(fixture.root, 'export.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, jsonFile);
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByText('JSON report exported.').waitFor();
    const report = ReportSchema.parse(JSON.parse(await readFile(jsonFile, 'utf8')));
    expect(report.summary).toContain('FIXTURE REPORT');
    expect(report.assessments[0]!.evidence).toHaveLength(2);
    const markdown = path.join(fixture.root, 'export.md');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, markdown);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    await page.getByText('Markdown report exported.').waitFor();
    expect(await readFile(markdown, 'utf8')).toContain('## Estimation');
    expect(desktop.errors).toEqual([]);
    await desktop.close();
    desktop = await fixture.launch(info);
    ({ page, app } = desktop);
    await page.getByRole('button', { name: 'Synthetic desktop journey', exact: true }).click();
    await page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
    expect(await fixture.calls()).toEqual(initialCalls);
    const saved = await page.evaluate(async () => {
      const project = (await window.aiden!.request('projects', {}))[0]!;
      return window.aiden!.request('state', { projectId: project.id });
    });
    expect(saved.runs.filter((r) => r.status === 'completed')).toHaveLength(2);
    await writeFile(fixture.control, JSON.stringify({ pause: true }));
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect
      .poll(async () => (await fixture.calls()).slice(-2))
      .toEqual(['discover', 'assess']);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    const cancelledCalls = await fixture.calls();
    await desktop.close();
    desktop = await fixture.launch(info);
    ({ page } = desktop);
    await page.getByRole('button', { name: 'Synthetic desktop journey', exact: true }).click();
    await page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    expect(await fixture.calls()).toEqual(cancelledCalls);
    await writeFile(fixture.control, '{}');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
    // Discovery was checkpointed before interruption and must not be submitted again.
    expect((await fixture.calls()).filter((stage) => stage === 'discover')).toHaveLength(2);
    expect((await fixture.calls()).filter((stage) => stage === 'assess')).toHaveLength(3);
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});

test('quitting during analysis preserves the accepted report and requires an explicit resume after relaunch', async ({
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
    await desktop.page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect
      .poll(async () => (await fixture.calls()).slice(-2))
      .toEqual(['discover', 'assess']);
    const submitted = await fixture.calls();
    await desktop.close();
    desktop = await fixture.launch(info);
    await desktop.page
      .getByRole('button', { name: 'Synthetic desktop journey', exact: true })
      .click();
    await desktop.page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
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
    await desktop.page.getByRole('button', { name: 'Resume', exact: true }).click();
    await desktop.page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
    expect((await fixture.calls()).filter((stage) => stage === 'discover')).toHaveLength(2);
    expect((await fixture.calls()).filter((stage) => stage === 'assess')).toHaveLength(3);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});
