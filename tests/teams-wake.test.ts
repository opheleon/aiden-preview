import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type HostWorker, readStatus, TeamsHost } from '../apps/cli/src/teams-host.js';
import { listenForWakes, verifyWake, wakeSecret, wakeSettings } from '../apps/cli/src/wake.js';
import type { AccountStatus } from '../packages/contracts/src/api.js';

const key = { secret: 'k'.repeat(43), deviceId: 'dev-1' };
const at = new Date('2026-10-27T08:00:00Z');
const seconds = at.getTime() / 1000;

/** A wake request the way Aiden Teams signs one. */
function signed(body: string, timestamp = seconds, secret = key.secret) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { timestamp: String(timestamp), signature: `sha256=${signature}`, body };
}

const wakeBody = JSON.stringify({ type: 'wake', deviceId: 'dev-1', at: at.toISOString() });

void test('wake settings come from the port and the Fly.io app name, or an explicit address', () => {
  assert.equal(wakeSettings({}), null);
  assert.equal(wakeSettings({ AIDEN_WAKE_PORT: '8080' }), null);
  assert.equal(wakeSettings({ AIDEN_WAKE_PORT: 'nope', FLY_APP_NAME: 'dana' }), null);
  assert.deepEqual(wakeSettings({ AIDEN_WAKE_PORT: '8080', FLY_APP_NAME: 'dana' }), {
    port: 8080,
    url: 'https://dana.fly.dev/wake',
  });
  assert.deepEqual(
    wakeSettings({ AIDEN_WAKE_PORT: '9000', AIDEN_WAKE_URL: 'https://worker.example.com/wake' }),
    { port: 9000, url: 'https://worker.example.com/wake' },
  );
  assert.throws(
    () => wakeSettings({ AIDEN_WAKE_PORT: '1', AIDEN_WAKE_URL: 'nope' }),
    /not an address/,
  );
  assert.match(wakeSecret(), /^[A-Za-z0-9_-]{43}$/);
});

void test('only a recent wake signed with this run key, for this machine, is accepted', () => {
  assert.equal(verifyWake(key, signed(wakeBody), at), true);
  assert.equal(verifyWake(key, signed(wakeBody, seconds - 301), at), false);
  assert.equal(verifyWake(key, signed(wakeBody, seconds, 'x'.repeat(43)), at), false);
  assert.equal(verifyWake(key, { ...signed(wakeBody), timestamp: undefined }, at), false);
  assert.equal(verifyWake(key, { ...signed(wakeBody), signature: 'sha256=zz' }, at), false);
  const other = JSON.stringify({ type: 'wake', deviceId: 'dev-2' });
  assert.equal(verifyWake(key, signed(other), at), false);
  assert.equal(verifyWake(key, signed('not json'), at), false);
});

void test('the listener answers wakes, a plain visit, and nothing else', async () => {
  let wakes = 0;
  const server = await listenForWakes({
    port: 0,
    key: () => key,
    onWake: () => (wakes += 1),
    now: () => at,
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** Post a body with the given signature headers. */
  const post = (request: ReturnType<typeof signed>) =>
    fetch(`${base}/wake`, {
      method: 'POST',
      headers: { 'x-aiden-timestamp': request.timestamp, 'x-aiden-signature': request.signature },
      body: request.body,
    });
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/other`)).status, 404);
    assert.equal((await post(signed(wakeBody))).status, 202);
    assert.equal((await post(signed(wakeBody))).status, 202);
    assert.equal(wakes, 1, 'wakes within five seconds ask for work once');
    assert.equal((await post(signed(wakeBody, seconds, 'x'.repeat(43)))).status, 401);
    assert.equal((await post(signed('a'.repeat(5000)))).status, 401);
  } finally {
    server.close();
  }
});

/** A signed-in worker stand-in whose wake registration can be made to fail. */
function signedInWorker(options: { refuseWake?: boolean } = {}) {
  const status: AccountStatus = {
    signedIn: true,
    email: 'dana@example.com',
    userId: 'u1',
    accounts: [{ id: 'a1', name: 'Team' }],
    message: null,
    deviceName: 'Fly.io worker',
    pickupEnabled: true,
    usageCapPct: 70,
    signingIn: false,
    running: null,
    last: { type: 'hold', reason: 'No work is waiting', at: at.toISOString() },
  };
  const calls: { method: string; params?: unknown }[] = [];
  const events = new EventEmitter();
  const worker = {
    request: (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'accountStatus') return Promise.resolve(structuredClone(status));
      if (method === 'accountRegisterWake')
        return options.refuseWake
          ? Promise.reject(new Error('Unknown machine.'))
          : Promise.resolve({ deviceId: 'dev-1', url: 'https://dana.fly.dev/wake' });
      return Promise.resolve({ pollAfterSeconds: 60 });
    },
    on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
    close: () => Promise.resolve(),
  } as unknown as HostWorker;
  return { worker, status, calls };
}

void test('a registered worker stops after a quiet spell, but not while a task runs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-teams-wake-'));
  const fake = signedInWorker();
  let now = at.getTime();
  let idled = 0;
  const lines: string[] = [];
  const host = new TeamsHost({
    worker: fake.worker,
    root,
    log: (line) => lines.push(line),
    now: () => new Date(now),
    wake: { port: 8080, url: 'https://dana.fly.dev/wake', secret: key.secret },
    idleStopMs: 15 * 60_000,
    onIdle: () => (idled += 1),
  });

  await host.check();
  assert.deepEqual(fake.calls.find((call) => call.method === 'accountRegisterWake')?.params, {
    url: 'https://dana.fly.dev/wake',
    secret: key.secret,
  });
  assert.equal((await readStatus(root))?.wakeUrl, 'https://dana.fly.dev/wake');
  assert.ok(lines.some((line) => line.includes('stops after 15 minutes')));
  assert.ok(
    lines.every((line) => !line.includes(key.secret)),
    'the key is never logged',
  );

  fake.status.running = { taskId: 't1', title: 'Check', projectId: 'p1', startedAt: 'now' };
  now += 20 * 60_000;
  await host.check();
  assert.equal(idled, 0);

  fake.status.running = null;
  now += 14 * 60_000;
  await host.check();
  assert.equal(idled, 0);
  now += 2 * 60_000;
  await host.check();
  assert.equal(idled, 1);
  assert.ok(
    lines.includes('No team work for 15 minutes. Stopping until the team wakes this machine.'),
  );
  await host.stop();
});

void test('a worker the team cannot wake stays on', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-teams-wake-'));
  const fake = signedInWorker({ refuseWake: true });
  let now = at.getTime();
  let idled = 0;
  const lines: string[] = [];
  const host = new TeamsHost({
    worker: fake.worker,
    root,
    log: (line) => lines.push(line),
    now: () => new Date(now),
    wake: { port: 8080, url: 'https://dana.fly.dev/wake', secret: key.secret },
    idleStopMs: 60_000,
    onIdle: () => (idled += 1),
  });
  await host.check();
  now += 10 * 60_000;
  await host.check();
  assert.equal(idled, 0);
  assert.equal((await readStatus(root))?.wakeUrl, null);
  assert.ok(lines.some((line) => line.includes('so it stays on: Unknown machine.')));
  await host.stop();
});
