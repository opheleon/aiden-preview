import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { discoverRepositories } from '../../packages/tools/src/discovery.js';
import { fixture, g } from '../helpers.js';
import { providerLauncher } from './provider-launcher.js';

export async function desktopFixture() {
  const f = await fixture();
  await mkdir(path.join(f.root, '.remotes'));
  for (const repo of f.project.repositories) {
    const remote = path.join(f.root, '.remotes', `${repo.id}.git`);
    await g(f.root, 'clone', '--bare', repo.path, remote);
    await g(repo.path, 'remote', 'add', 'origin', remote);
  }
  const discovered = await discoverRepositories(f.root);
  for (const snapshot of f.snapshots) {
    const old = f.project.repositories.find((r) => r.id === snapshot.repositoryId)!;
    snapshot.repositoryId = discovered.repositories.find(
      (r) => path.basename(r.path) === path.basename(old.path),
    )!.id;
  }
  f.project.repositories = discovered.repositories;
  const { binary, claude, control, calls } = await providerLauncher(f);
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.NODE_OPTIONS;
  let sequence = 0;
  async function launch(info: TestInfo, overrides: Record<string, string> = {}, showGuide = false) {
    const packagedApp = process.env.AIDEN_PACKAGED_APP;
    const app = await electron.launch({
      timeout: 30_000,
      ...(packagedApp
        ? { executablePath: packagedApp, args: [] }
        : { args: ['dist/apps/desktop/src/main.js'] }),
      env: {
        ...env,
        // Packaged journeys must work without a developer's cached browser installation.
        ...(packagedApp
          ? { PLAYWRIGHT_BROWSERS_PATH: path.join(f.root, 'unavailable-browser-cache') }
          : {}),
        AIDEN_HEADLESS: '1',
        AIDEN_HOME: path.join(f.root, 'desktop-data'),
        AIDEN_CODEX_BINARY: binary,
        AIDEN_CLAUDE_BINARY: claude,
        // Probe no default ports, so whatever runs on this machine never joins the journey.
        AIDEN_APP_PORTS: '',
        PATH:
          process.platform === 'darwin'
            ? '/usr/bin:/bin:/usr/sbin:/sbin'
            : (process.env.PATH ?? '/usr/bin:/bin'),
        ...overrides,
      },
    });
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    const page = await app.firstWindow();
    await page.locator('[data-guide-ready="true"]').waitFor();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          visible: window.isVisible(),
          focused: window.isFocused(),
          focusable: window.isFocusable(),
        })),
      ),
    ).toEqual([{ visible: false, focused: false, focusable: false }]);
    if (!showGuide && (await page.getByRole('dialog').filter({ visible: true }).count())) {
      // Existing journeys start after onboarding; finish through the public UI so reloads stay clear.
      while (await page.getByRole('button', { name: 'Next', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
      await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0);
    }
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let closed = false;
    return {
      app,
      page,
      errors,
      close: async () => {
        if (closed) return;
        closed = true;
        const trace = info.outputPath(`desktop-${++sequence}.zip`);
        try {
          await app.context().tracing.stop({ path: trace });
          await info.attach('desktop trace', { path: trace, contentType: 'application/zip' });
        } finally {
          await app.close();
        }
      },
    };
  }
  return {
    f,
    launch,
    control,
    binary,
    calls: async () => (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean),
    root: await realpath(f.root),
  };
}

/** Hand a project to Aiden in one step and wait for its first brief; nothing asks for approval. */
export async function createProject(
  app: ElectronApplication,
  page: Page,
  root: string,
  blocked = false,
) {
  await page.getByLabel('What are you building?').fill('Users can list and create books.');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, root);
  await page
    .getByRole('button', { name: 'Add the project folder (optional)', exact: true })
    .click();
  await page.getByRole('button', { name: /· 2 repositories/ }).waitFor();
  await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
  // Setup opens above the project; Back returns to the Overview.
  await expect(page.getByRole('dialog', { name: 'Chat with Aiden' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('progressbar').waitFor();
  if (blocked) {
    await expect(page.getByText(/Delivery paused: resolve blocking decisions/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  } else await expectIdle(page);
}

/** Start a new assessment from the project header. */
export async function lookAgain(page: Page) {
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Run check now', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chat with Aiden' })
    .getByRole('button', { name: 'Back', exact: true })
    .click();
}

/** Wait for automatically chained sizing before a journey requests another operation. */
async function expectIdle(page: Page): Promise<void> {
  await expect(page.getByText(/estimated complexity points/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
}
