import path from 'node:path';

import { _electron as electron, expect, type Page, test } from '@playwright/test';

import { fixture } from '../helpers.js';

// Live provider runs: no fixture runtime and no binary overrides. Results are real model output
// on the synthetic two-repository books project from tests/helpers.ts.
const answer =
  'This is a synthetic end-to-end test. Assess listing and creating books using only the two fixture repositories. No additional constraints.';
const signIn = {
  codex: 'Sign in with Codex in Aiden, or run: codex login',
  claude: 'Sign in with your Claude subscription: claude auth login --claudeai',
};

for (const provider of ['codex', 'claude'] as const) {
  test(`${provider} subscription completes a full run in the desktop app`, async ({
    browserName,
  }, testInfo) => {
    testInfo.annotations.push({ type: 'browser engine', description: browserName });
    const f = await fixture();
    const env = { ...process.env };
    // Subscription runs must not depend on API keys; keep them out of the app entirely.
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    const app = await electron.launch({
      timeout: 30000,
      args: ['dist/apps/desktop/src/main.js'],
      env: {
        ...env,
        AIDEN_HOME: path.join(f.root, 'desktop-data'),
      },
    });
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      const diagnostics = await page.evaluate(() => window.aiden!.request('diagnostics', {}));
      const status = diagnostics.find((d) => d.provider === provider);
      const signedIn =
        provider === 'claude'
          ? status?.subscriptionState === 'authenticated'
          : status?.subscription;
      if (!status?.installed || !signedIn)
        throw new Error(`${provider} subscription is not available. ${signIn[provider]}`);

      await page.getByLabel('Project description').fill(f.project.context);
      await page.getByLabel('Model runtime').selectOption(provider);
      await page.locator('.goal-starter-create').click();
      await page.getByPlaceholder('e.g. Customer portal').fill(`E2E ${provider} project`);
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [root] });
      }, f.root);
      await page.getByRole('button', { name: 'Choose project folder', exact: true }).click();
      await expect(page.getByTestId('discovered-repository')).toHaveCount(2);
      await expect(page.getByLabel('Authentication', { exact: true })).toHaveValue('subscription');
      await expect(page.getByText('Subscription credentials available')).toBeVisible();

      await page.getByRole('button', { name: 'Add project context' }).click();
      await page.getByRole('button', { name: 'Prepare requirements' }).click();
      const review = page.getByRole('heading', { name: 'Reviewed baseline' });
      await until(page, () => review.isVisible());
      const requirements = page.locator('.requirement textarea');
      expect(await requirements.count()).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Approve & run analysis' }).click();
      const projectId = (await page.evaluate(() => window.aiden!.request('projects', {}))).find(
        (p) => p.name === `E2E ${provider} project`,
      )!.id;
      const runs = () =>
        page.evaluate(
          async (id) => (await window.aiden!.request('state', { projectId: id })).runs,
          projectId,
        );
      // The app starts the estimate automatically once the report completes.
      await until(page, async () => {
        const estimate = (await runs()).find((r) => r.kind === 'estimate');
        return (
          !!estimate &&
          ['completed', 'failed', 'cancelled'].includes(estimate.status) &&
          (await page.locator('.progress').count()) === 0
        );
      });

      const latest = await runs();
      const report = latest.find((r) => r.kind === 'report')!;
      expect(report.status, report.error).toBe('completed');
      const estimate = latest.find((r) => r.kind === 'estimate')!;
      expect(estimate.status, estimate.error).toBe('completed');
      const result = await page.evaluate((ref) => window.aiden!.request('result', ref), {
        projectId,
        runId: report.id,
      });
      expect(result.assessments.length).toBeGreaterThan(0);
      expect(result.assessments.some((a) => a.evidence.length > 0)).toBe(true);
      await expect(page.locator('.callout.error')).toHaveCount(0);
      expect(errors).toEqual([]);
      await testInfo.attach('final report', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } catch (error) {
      await testInfo.attach('failure', {
        body: await page.screenshot({ fullPage: true }).catch(() => Buffer.from('')),
        contentType: 'image/png',
      });
      const trace = testInfo.outputPath('trace.zip');
      await app.context().tracing.stop({ path: trace });
      await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
      throw error;
    } finally {
      await app
        .context()
        .tracing.stop()
        .catch(() => {});
      await app.close();
    }
  });
}

// Waits for a condition while answering clarification questions and failing fast on app errors.
async function until(page: Page, done: () => Promise<boolean>) {
  const clarification = page.getByRole('dialog', { name: 'Clarification' });
  const failure = page.locator('.callout.error');
  for (;;) {
    if (await failure.count()) throw new Error(`App error: ${await failure.innerText()}`);
    if (await clarification.isVisible()) {
      await clarification.getByLabel('Clarification answer').fill(answer);
      await clarification.getByRole('button', { name: 'Continue' }).click();
      await expect(clarification).toBeHidden();
    }
    if (await done()) return;
    await page.waitForTimeout(1000);
  }
}
