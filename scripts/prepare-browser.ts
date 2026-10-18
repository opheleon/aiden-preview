import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Download the pinned Playwright browser and video encoder into the packaging resources.
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
execFileSync(process.execPath, [cli, 'install', '--only-shell', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve('release/browser-runtime') },
});
