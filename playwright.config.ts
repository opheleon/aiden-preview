import { defineConfig } from '@playwright/test';

// Live end-to-end runs through the desktop app. They use the installed provider CLIs and your
// subscription sign-in, so they take minutes and spend real quota.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
