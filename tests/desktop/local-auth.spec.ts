import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { demoAccount, startAuthDemo } from '../../scripts/local-auth-demo/server.js';
import { desktopFixture } from './journey-fixture.js';

test('setup chat proves real database-backed web login and API-key access before confirming', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const f = await desktopFixture();
  const demo = await startAuthDemo(path.join(f.root, 'auth-demo'));
  await writeFile(
    f.control,
    JSON.stringify({
      guideReply: {
        reply: 'Synthetic provider reply. Choose how to test this local app.',
        widgets: [{ type: 'verify-options', recommended: null, url: null, link: null }],
        actions: [],
      },
    }),
  );
  let desktop = await f.launch(info);
  try {
    const page = desktop.page;
    await page
      .getByLabel('What are you building?')
      .fill('A notes app with a real login and database.');
    await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
    const chat = page.getByRole('dialog', { name: 'Chat with Aiden' });
    await expect(chat).toBeVisible();
    await chat.getByRole('button', { name: 'Looks right' }).click();
    await chat.getByRole('checkbox', { name: 'Web app', exact: true }).check();
    await expect(chat.getByRole('checkbox', { name: /iPhone/ })).toHaveCount(0);
    await chat.getByLabel('Where does the app run?').fill(`${demo.origin}/app`);
    await chat.getByLabel('Sign in before testing').check();
    await chat.getByLabel('Remember test credentials on this device').uncheck();
    await chat.getByLabel('Login page URL').fill(`${demo.origin}/login`);
    await expect(chat.getByLabel('Text visible after sign-in')).toHaveCount(0);
    await chat.getByLabel('Test account email').fill(demoAccount.email);
    await chat.getByLabel('Test account password').fill('incorrect-disposable-password');
    await chat.getByRole('button', { name: 'Check access' }).click();
    await expect(chat.getByRole('alert')).toContainText('Could not verify sign-in', {
      timeout: 20000,
    });
    await expect(chat.getByRole('button', { name: 'Confirm setup' })).toBeDisabled();
    await chat.getByLabel('Test account password').fill(demoAccount.password);
    await chat.getByRole('checkbox', { name: 'API', exact: true }).check();
    await chat.getByLabel('API base URL').fill(`${demo.origin}/api/`);
    await chat.getByLabel('API key', { exact: true }).fill(demoAccount.apiKey);
    await chat.getByRole('button', { name: 'Check access' }).click();
    await expect(chat.getByRole('status').filter({ hasText: 'Access checked' })).toContainText(
      'Access checked',
      { timeout: 20000 },
    );
    await page.screenshot({ path: info.outputPath('private-setup-checked.png') });
    await writeFile(
      f.control,
      JSON.stringify({
        guideReply: {
          reply: 'Synthetic provider reply. The local setup is saved.',
          widgets: [],
          actions: [],
        },
      }),
    );
    await chat.getByRole('button', { name: 'Confirm setup' }).click();
    await expect(chat.getByText('Synthetic provider reply. The local setup is saved.')).toBeVisible(
      { timeout: 20000 },
    );
    const visible = await chat.innerText();
    expect(visible).not.toContain(demoAccount.password);
    expect(visible).not.toContain(demoAccount.apiKey);
    await expect(
      chat.getByText(/Test credentials are in memory for this session only/),
    ).toBeVisible();
    const projectsDir = path.join(f.root, 'desktop-data', 'projects');
    const projectIds = await readdir(projectsDir);
    expect(projectIds).toHaveLength(1);
    const stored = await readFile(
      path.join(projectsDir, projectIds[0]!, 'verification.json'),
      'utf8',
    );
    expect(stored).not.toContain(demoAccount.password);
    expect(stored).not.toContain(demoAccount.apiKey);
    expect(JSON.parse(stored).credentialStorage).toBe('session');
    // Recheck in a fresh browser using only public settings. Neither the renderer request nor
    // the provider receives a password or API key on this subsequent sign-in.
    const reused = await page.evaluate(async (projectId) => {
      const settings = await window.aiden!.request('verificationSettings', { projectId });
      return window.aiden!.request('configureGuideVerification', {
        projectId,
        update: { url: settings.url, webLogin: settings.webLogin, api: settings.api },
        save: false,
      });
    }, projectIds[0]!);
    expect(reused.message).toContain('Access checked');
    const beforeRestart = await page.evaluate(
      async (projectId) => window.aiden!.request('guide', { projectId }),
      projectIds[0]!,
    );
    expect(beforeRestart.setup.steps.find((step) => step.id === 'verify')?.status).toBe('done');
    expect(desktop.errors).toEqual([]);
    await desktop.close();
    desktop = await f.launch(info);
    const restarted = await desktop.page.evaluate(
      async (projectId) => window.aiden!.request('verificationSettings', { projectId }),
      projectIds[0]!,
    );
    expect(restarted.webCredentialsConfigured).toBe(false);
    expect(restarted.apiKeyConfigured).toBe(false);
    const afterRestart = await desktop.page.evaluate(
      async (projectId) => window.aiden!.request('guide', { projectId }),
      projectIds[0]!,
    );
    expect(afterRestart.setup.steps.find((step) => step.id === 'verify')?.status).not.toBe('done');
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
    await demo.close();
  }
});
