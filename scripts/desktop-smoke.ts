import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { _electron as electron, expect } from '@playwright/test';

import { ReportSchema } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { verifyPackagedRuntimes } from '../tests/desktop/native-runtime.js';
import { providerLauncher } from '../tests/desktop/provider-launcher.js';
import { updateFixture } from '../tests/desktop/update-fixture.js';
import { FixtureRuntime } from '../tests/fixture-runtime.js';
import { fixture } from '../tests/helpers.js';
const f = await fixture();
const provider = await providerLauncher(f);
const env = { ...process.env };
delete env.OPENAI_API_KEY;
delete env.ANTHROPIC_API_KEY;
f.project.name = 'Fixture book project';
f.project.runtime = { provider: 'claude', auth: 'apiKey' };
const home = path.join(f.root, 'desktop-data');
const engine = new Engine(new Store(home), new FixtureRuntime(f));
const p = await engine.prepare(f.project);
await engine.wait(p.runId);
await engine.approve(f.project.id, p.runId, f.product);
const run = await engine.report(f.project.id);
await engine.wait(run.runId);
await engine.dispose();
const claudeFixture = path.join(f.root, 'claude-auth-fixture');
const packagedApp = process.env.AIDEN_PACKAGED_APP;
/** Replace the isolated Claude auth executable with a deterministic signed-in or signed-out response. */
async function setClaudeFixture(loggedIn: boolean) {
  const status = loggedIn
    ? {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'max',
      }
    : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' };
  await writeFile(
    claudeFixture,
    '#!/usr/bin/env node\nprocess.stdout.write(' +
      JSON.stringify(JSON.stringify(status)) +
      ');process.exit(' +
      (loggedIn ? '0' : '1') +
      ');\n',
    { mode: 0o755 },
  );
}
await setClaudeFixture(false);
const app = await electron.launch({
  timeout: 30000,
  ...(packagedApp
    ? { executablePath: packagedApp, args: [] }
    : { args: ['dist/apps/desktop/src/main.js'] }),
  env: {
    ...env,
    AIDEN_CODEX_BINARY: provider.binary,
    AIDEN_HOME: home,
    AIDEN_CLAUDE_BINARY: claudeFixture,
  },
});
let updates: Awaited<ReturnType<typeof updateFixture>> | undefined;
let tracing = false;
try {
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  tracing = true;
  const page = await app.firstWindow();
  await page.locator('[data-guide-ready="true"]').waitFor();
  if (await page.getByRole('dialog').isVisible())
    await page.getByRole('button', { name: 'Later', exact: true }).click();
  if (packagedApp) {
    await verifyPackagedRuntimes(app);
    updates = await updateFixture(app);
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /What are you building/ }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results/desktop-smoke', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop-smoke/setup.png', fullPage: true });
  await page
    .getByLabel('What are you building?')
    .fill('Users can list books. Users can create books.');
  const handOff = page.getByRole('button', { name: /Hand it to Aiden/ });
  await expect(handOff).toBeDisabled();
  await app.evaluate(({ dialog }, repo) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repo] });
  }, f.root);
  const rootName = path.basename(await realpath(f.root));
  await page.getByRole('button', { name: 'Choose the project folder', exact: true }).click();
  await expect(page.getByRole('button', { name: `${rootName} · 2 repositories` })).toBeVisible();
  await expect(handOff).toBeEnabled();
  // Empty roots have an honest recovery state and cannot be handed over.
  const emptyFolder = path.join(f.root, 'empty-project');
  await mkdir(emptyFolder);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, emptyFolder);
  await page.getByRole('button', { name: `${rootName} · 2 repositories` }).click();
  await expect(page.getByText(/No Git repositories with commits were found/)).toBeVisible();
  await expect(handOff).toBeDisabled();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, f.root);
  await page.getByRole('button', { name: /empty-project/ }).click();
  await expect(page.getByRole('button', { name: /· 2 repositories/ })).toBeVisible();
  // Cancelled selection keeps the existing root and repositories.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: /· 2 repositories/ }).click();
  await expect(page.getByRole('button', { name: /· 2 repositories/ })).toBeEnabled();
  const contextFile = path.join(f.root, 'context.md');
  await writeFile(contextFile, 'Users can export books.');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, contextFile);
  await page.getByRole('button', { name: 'Import a file' }).click();
  await expect(page.getByLabel('What are you building?')).toHaveValue(
    /Users can list books\. Users can create books\.\n\nUsers can export books\./,
  );
  await page.screenshot({ path: 'test-results/desktop-smoke/intent-fixture.png', fullPage: true });
  // Provider sign-in lives in settings; the unsaved project keeps its intent meanwhile.
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(page.getByLabel('Authentication', { exact: true })).toHaveValue('subscription');
  await expect(page.getByTestId('claude-connection')).toContainText('Sign in to Claude Code');
  await expect(page.getByTestId('claude-connection').locator('code')).toHaveText(
    'claude auth login --claudeai',
  );
  await expect(page.getByRole('button', { name: 'Sign in with Codex' })).toHaveCount(0);
  await setClaudeFixture(true);
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByTestId('claude-connection')).toContainText('sign-in detected');
  await expect(page.getByTestId('claude-connection').locator('code')).toHaveCount(0);
  await setClaudeFixture(false);
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByTestId('claude-connection')).toContainText('Sign in to Claude Code');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await page.getByRole('button', { name: 'A book project' }).click();
  await page.getByRole('region', { name: 'Requirements' }).waitFor();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const log = page.getByRole('region', { name: 'Activity' });
  await expect(log).toBeVisible();
  // Why? opens the run's conversation, answered from the reason logged when Aiden acted.
  await log
    .getByRole('button', { name: /^Why: REQ-/ })
    .first()
    .click();
  await expect(log.getByText(/From the run log/)).toBeVisible();
  await expect(log.getByRole('textbox', { name: 'Ask about this run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh status' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop-smoke/brief-fixture.png', fullPage: true });
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.locator('.req-row > summary').first().click();
  await page.getByRole('button', { name: /frontend · app.txt:1/ }).click();
  await page.getByRole('dialog', { name: 'Code evidence' }).waitFor();
  if (!(await page.locator('pre').innerText()).includes('GET /books'))
    throw new Error('Evidence did not open.');
  await page.getByRole('button', { name: 'Close evidence' }).click();
  const exportFile = path.join(f.root, 'export.md');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, exportFile);
  await page.getByLabel('More').click();
  await page.getByRole('menuitem', { name: 'Export Markdown' }).click();
  await page.getByText('Markdown report exported.').waitFor();
  if (!(await readFile(exportFile, 'utf8')).includes('FIXTURE REPORT'))
    throw new Error('Export failed.');
  const jsonFile = path.join(f.root, 'export.json');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, jsonFile);
  await page.getByLabel('More').click();
  await page.getByRole('menuitem', { name: 'Export JSON' }).click();
  await page.getByText('JSON report exported.').waitFor();
  if (ReportSchema.parse(JSON.parse(await readFile(jsonFile, 'utf8'))).id !== run.runId)
    throw new Error('JSON export identity mismatch.');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Application settings.' }).waitFor();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByText('Enter a model ID', { exact: true }).click();
  await page.getByLabel('Model ID', { exact: true }).fill('fixture-selected-model');
  await page.getByRole('button', { name: 'Save model settings', exact: true }).click();
  await page.getByText('Model settings saved for this project.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('fixture-selected-model');
  await expect(page.getByLabel('Authentication', { exact: true })).toHaveValue('apiKey');
  const savedRuntime = await page.evaluate(
    async (projectId) => (await window.aiden!.request('state', { projectId })).project.runtime,
    f.project.id,
  );
  if (savedRuntime.model !== 'fixture-selected-model' || savedRuntime.auth !== 'apiKey')
    throw new Error('Saved runtime changed during refresh.');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('region', { name: 'App URL settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Desktop app', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'App updates' })).toBeVisible();
  if (updates) {
    await expect(page.getByText(updates.version, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText('You are on the latest version.')).toBeVisible({ timeout: 20000 });
    expect(updates.requests.some((url) => url.split('?')[0]?.endsWith('-mac.yml'))).toBe(true);
    updates.setUnavailable(true);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(
      page.getByText('The update could not be completed. Check your connection and retry.'),
    ).toBeVisible();
    updates.setUnavailable(false);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText('You are on the latest version.')).toBeVisible();
  } else {
    await expect(
      page.getByText('Automatic updates are available in the installed desktop app.'),
    ).toBeVisible();
  }
  await expect(page.getByLabel('Download updates automatically')).toBeChecked();
  await page.getByLabel('Download updates automatically').uncheck();
  await expect(page.getByLabel('Download updates automatically')).not.toBeChecked();
  await page.getByLabel('Download updates automatically').check();
  await expect(page.getByLabel('Download updates automatically')).toBeChecked();
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toBeVisible();
  await page.getByRole('button', { name: 'A book project' }).click();
  await page.getByRole('region', { name: 'Requirements' }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: [
        'Electron startup',
        'typed worker bridge',
        'Claude subscription setup, connection refresh, and saved API-key choice',
        'one-screen intent with folder discovery, empty-root recovery, cancelled selection, and file import',
        'persisted history and action log',
        'Why? conversation answered from the run log',
        'validated fixture brief',
        'evidence viewer',
        'Markdown and JSON exports from the overflow menu',
        'Settings, project app URL, and hosted MCP integration view',
        'desktop update status and preference bridge',
        'saved provider/auth/model survives connection refresh',
        ...(packagedApp
          ? [
              'native keyring load, bundled Claude execution, local update feed check, failure, and retry',
            ]
          : []),
      ],
      fixtures: true,
      screenshots: 'test-results/desktop-smoke',
    }),
  );
} finally {
  try {
    if (tracing) await app.context().tracing.stop({ path: 'test-results/desktop-smoke/trace.zip' });
  } finally {
    await app.close();
    await updates?.close();
  }
}
