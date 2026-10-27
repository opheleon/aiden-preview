import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AccountPoller } from '../packages/core/src/accounts/poller.js';

void test('polling stays within one minute even when idle, disabled, or recovering from an error', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const request = () => {
    calls++;
    if (calls === 3) return Promise.reject(new Error('outage'));
    return Promise.resolve({ pollAfterSeconds: 300 });
  };
  const poller = new AccountPoller({
    worker: { request },
    idleSeconds: () => 600,
    onBattery: () => false,
  });
  const tick = async (ms: number) => {
    context.mock.timers.tick(ms);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  poller.start();
  await tick(5000);
  assert.equal(calls, 1);
  await tick(59999);
  assert.equal(calls, 1);
  await tick(1);
  assert.equal(calls, 2);
  await tick(60000);
  assert.equal(calls, 3);
  await tick(60000);
  assert.equal(calls, 4);
  poller.stop();
  await tick(180000);
  assert.equal(calls, 4);
});
