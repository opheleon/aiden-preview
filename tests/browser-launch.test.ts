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
