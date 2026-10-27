import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright';

import { launchBrowser } from '../packages/verification/src/index.js';

void test('browser startup errors offer recovery for the installed app without exposing native details', async (t) => {
  t.mock.method(chromium, 'launch', () =>
    Promise.reject(new Error('private-native-launch-detail')),
  );
  const previous = process.env.AIDEN_PACKAGED;
  try {
    for (const packaged of ['0', '1']) {
      process.env.AIDEN_PACKAGED = packaged;
      await assert.rejects(launchBrowser(), (error: Error) => {
        assert.ok(!error.message.includes('private-native-launch-detail'));
        if (packaged === '1') {
          assert.match(error.message, /reinstall the latest version/);
          assert.ok(!error.message.includes('pnpm'));
        } else assert.match(error.message, /pnpm exec playwright install chromium/);
        return true;
      });
    }
  } finally {
    if (previous === undefined) delete process.env.AIDEN_PACKAGED;
    else process.env.AIDEN_PACKAGED = previous;
  }
});

void test('the browser sandbox is required except on Linux, where a blocked sandbox falls back', async (t) => {
  const options: unknown[] = [];
  t.mock.method(chromium, 'launch', (option: { chromiumSandbox?: boolean }) => {
    options.push(option);
    return option.chromiumSandbox
      ? Promise.reject(new Error('No usable sandbox'))
      : Promise.resolve({ fixture: 'unsandboxed browser' });
  });
  await assert.rejects(launchBrowser('darwin'), /could not start/);
  await assert.rejects(launchBrowser('win32'), /could not start/);
  assert.deepEqual(options, [
    { headless: true, chromiumSandbox: true },
    { headless: true, chromiumSandbox: true },
  ]);
  assert.deepEqual(await launchBrowser('linux'), { fixture: 'unsandboxed browser' });
  assert.deepEqual(options.slice(2), [
    { headless: true, chromiumSandbox: true },
    { headless: true },
  ]);
});
