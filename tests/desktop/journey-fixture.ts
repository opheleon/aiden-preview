import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test';

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
  // Stand in for github.com: acme/frontend and acme/backend clone from these bare remotes.
  await mkdir(path.join(f.root, '.github-base'));
  await symlink(path.join(f.root, '.remotes'), path.join(f.root, '.github-base', 'acme'));
  // Connected repositories are identified by their GitHub link, so the synthetic evidence is too.
  const githubId = (name: string) =>
    `repo-${createHash('sha256').update(`https://github.com/acme/${name}`).digest('hex').slice(0, 16)}`;
  for (const snapshot of f.snapshots) snapshot.repositoryId = githubId(snapshot.repositoryId);
  f.project.repositories = f.project.repositories.map((repo) => ({
    ...repo,
    id: githubId(repo.id),
  }));
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
        AIDEN_GITHUB_CLONE_BASE: path.join(f.root, '.github-base'),
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

/** Paste the fixture's two GitHub repositories into a repository list. */
export async function addFixtureRepositories(scope: Page | ReturnType<Page['getByRole']>) {
  for (const name of ['acme/frontend', 'acme/backend']) {
    await scope.getByLabel('GitHub repository link').fill(`https://github.com/${name}`);
    await scope.getByRole('button', { name: 'Add', exact: true }).click();
  }
}

/**
 * Hand a project to Aiden from its goal, confirm the requirements, and connect the fixture's
 * GitHub repositories in the setup chat, then wait for its first brief. Blocking questions hold
 * setup in the chat, so a blocked journey connects the code from Project settings instead.
 */
export async function createProject(
  _app: ElectronApplication,
  page: Page,
  _root: string,
  blocked = false,
) {
  await page.getByLabel('What are you building?').fill('Users can list and create books.');
  await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
  const chat = page.getByRole('tabpanel', { name: 'Chat' });
  await expect(chat).toBeVisible();
  if (blocked) {
    await page
      .getByRole('button', { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Project settings' }).click();
    await addFixtureRepositories(page);
    await page.getByRole('button', { name: /Save repositories/ }).click();
    await page.getByText(/Repositories saved|Saved\./).waitFor();
    await page.locator('.project-row .project-link').first().click();
  } else {
    await chat.getByRole('button', { name: 'Looks right' }).click();
    const code = chat.getByRole('region', { name: 'Connect your code' });
    await addFixtureRepositories(code);
    await code.getByRole('button', { name: 'Use these repositories', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
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
  await expect(page.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
}

/** Wait for automatically chained sizing before a journey requests another operation. */
async function expectIdle(page: Page): Promise<void> {
  await expect(page.getByText(/estimated complexity points/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
}
