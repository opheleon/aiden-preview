import path from 'node:path';

import { expect, test } from '@playwright/test';

import { demoAccount, startAuthDemo } from '../../scripts/local-auth-demo/server.js';
import { createProject, desktopFixture } from './journey-fixture.js';

test('project connections check access before saving and keep API keys private across renderer reload', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const f = await desktopFixture();
  const demo = await startAuthDemo(path.join(f.root, 'auth-demo'));
  const running = await f.launch(info);
  try {
    const { page } = running;
    await createProject(running.app, page, f.root);
    await expect(page.getByRole('button', { name: 'Verification', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Runs/ })).toHaveCount(0);
    const callsBefore = await f.calls();
    await page
      .getByRole('region', { name: 'Project connections' })
      .getByRole('button', { name: 'Manage' })
      .click();
    const chat = page.getByRole('dialog', { name: 'Chat with Aiden' });
    await chat.getByRole('button', { name: 'API access' }).click();
    await expect(chat.getByLabel('API base URL')).toBeInViewport();
    expect(await f.calls()).toEqual(callsBefore);
    await expect(chat.getByRole('checkbox', { name: /iPhone/ })).toHaveCount(0);
    await chat.getByLabel('API base URL').fill(`${demo.origin}/api/`);
    await chat.getByText('Automatic checks', { exact: true }).click();
    await chat.getByLabel('When to verify').selectOption('after_assessment');
    await chat.getByLabel('Remember test credentials on this device').uncheck();
    await chat.getByLabel('API key', { exact: true }).fill('incorrect-disposable-key');
    await chat.getByRole('button', { name: 'Check access & save' }).click();
    await expect(chat.getByRole('alert')).toContainText('rejected this key');
    expect(
      await page.evaluate(async () => {
        const project = (await window.aiden!.request('projects', {}))[0]!;
        return (await window.aiden!.request('verificationSettings', { projectId: project.id })).api;
      }),
    ).toBeUndefined();
    expect(await f.calls()).toEqual(callsBefore);
    await chat.getByLabel('API key', { exact: true }).fill(demoAccount.apiKey);
    await chat.getByRole('button', { name: 'Check access & save' }).click();
    await expect(chat.getByRole('region', { name: 'Edit project verification' })).toHaveCount(0);
    await chat.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('API · Connected', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('clean-project-overview.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'A book project', exact: true }).click();
    await page.getByRole('button', { name: 'Edit API' }).click();
    await expect(chat.getByLabel('API key', { exact: true })).toHaveValue('');
    await expect(chat.getByLabel('API key', { exact: true })).toHaveAttribute(
      'placeholder',
      'Saved key; enter to replace',
    );
    await expect(chat.getByLabel('API key header')).toHaveValue('X-API-Key');
    await chat.getByText('Automatic checks', { exact: true }).click();
    await expect(chat.getByLabel('When to verify')).toHaveValue('after_assessment');
    await page.screenshot({ path: info.outputPath('connection-edit-in-chat.png'), fullPage: true });
    await chat.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Edit API' })).toBeFocused();
    await page.getByRole('tab', { name: 'Scope', exact: true }).click();
    await page.getByRole('button', { name: 'Change REQ-1', exact: true }).click();
    await expect(chat.getByRole('region', { name: 'Selected requirement' })).toContainText('REQ-1');
    await expect(chat.getByRole('region', { name: 'Selected requirement' })).toBeInViewport();
    await chat.getByLabel('Message the Guide').fill('Keep this proposed change as a draft');
    await page.screenshot({
      path: info.outputPath('requirement-change-in-chat.png'),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Scope', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Change REQ-1', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Change REQ-1', exact: true }).click();
    await expect(chat.getByLabel('Message the Guide')).toHaveValue(
      'Keep this proposed change as a draft',
    );
    expect(running.errors).toEqual([]);
  } finally {
    await running.close();
    await demo.close();
  }
});
