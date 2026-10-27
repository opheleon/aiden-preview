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
    isBusy: () => false,
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

void test('settling waits for a request already on its way, and start resumes polling', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let answer: (value: { pollAfterSeconds: number }) => void = () => {};
  const request = () => {
    calls++;
    return new Promise<{ pollAfterSeconds: number }>((resolve) => (answer = resolve));
  };
  const poller = new AccountPoller({
    worker: { request },
    isBusy: () => false,
    idleSeconds: () => 600,
    onBattery: () => false,
  });
  poller.nudge();
  context.mock.timers.tick(0);
  assert.equal(calls, 1);
  let settled = false;
  const settling = poller.settle().then(() => (settled = true));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'the request in flight is still waiting');
  answer({ pollAfterSeconds: 15 });
  await settling;
  context.mock.timers.tick(60000);
  assert.equal(calls, 1, 'a settled poller asks no more');
  poller.start();
  context.mock.timers.tick(5000);
  assert.equal(calls, 2);
  poller.stop();
});
