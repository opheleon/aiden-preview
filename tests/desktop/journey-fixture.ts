import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { discoverRepositories } from '../../packages/tools/src/discovery.js';
import { fixture } from '../helpers.js';
import { providerLauncher } from './provider-launcher.js';

export async function desktopFixture() {
  const f = await fixture();
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
  async function launch(info: TestInfo, overrides: Record<string, string> = {}) {
    const packagedApp = process.env.AIDEN_PACKAGED_APP;
    const app = await electron.launch({
      timeout: 30_000,
      ...(packagedApp
        ? { executablePath: packagedApp, args: [] }
        : { args: ['dist/apps/desktop/src/main.js'] }),
      env: {
        ...env,
        AIDEN_HOME: path.join(f.root, 'desktop-data'),
        AIDEN_CODEX_BINARY: binary,
        AIDEN_CLAUDE_BINARY: claude,
        PATH:
          process.platform === 'darwin'
            ? '/usr/bin:/bin:/usr/sbin:/sbin'
            : (process.env.PATH ?? '/usr/bin:/bin'),
        ...overrides,
      },
    });
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    const page = await app.firstWindow();
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

export async function createProject(app: ElectronApplication, page: Page, root: string) {
  await page.getByLabel('Project description').fill('Users can list and create books.');
  await page.locator('.goal-starter-create').click();
  await page.getByLabel('Project name').fill('Synthetic desktop journey');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, root);
  await page.getByRole('button', { name: 'Choose project folder', exact: true }).click();
  await page.getByRole('button', { name: 'Add project context' }).click();
  await page.getByRole('button', { name: 'Prepare requirements' }).click();
  await page.getByLabel('Clarification answer').fill('Yes, list existing books.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Reviewed baseline' }).waitFor();
  await page.getByRole('button', { name: 'Approve & run analysis' }).click();
  await page.getByRole('heading', { name: 'Requirements & estimates' }).waitFor();
}
