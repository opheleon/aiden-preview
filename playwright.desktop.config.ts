import { defineConfig } from '@playwright/test';

// Credential-free journeys through the shipped renderer, Electron bridge, and worker.
export default defineConfig({
  testDir: 'tests/desktop',
  workers: 1,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
