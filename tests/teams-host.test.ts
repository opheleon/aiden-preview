import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  type HostWorker,
  loopbackCallback,
  readStatus,
  TeamsHost,
} from '../apps/cli/src/teams-host.js';
import type { AccountStatus } from '../packages/contracts/src/api.js';

/** A worker stand-in that answers account requests from a mutable status. */
function fakeWorker(initial: Partial<AccountStatus> = {}) {
  const status: AccountStatus = {
    signedIn: false,
    email: null,
    userId: null,
    accounts: [],
    message: null,
    deviceName: 'fly-worker',
    pickupEnabled: true,
    usageCapPct: 70,
    signingIn: false,
    running: null,
    last: null,
    ...initial,
  };
  const calls: string[] = [];
  let closed = false;
  const events = new EventEmitter();
  const worker = {
    request: (method: string) => {
      calls.push(method);
      if (method === 'accountStatus') return Promise.resolve(structuredClone(status));
      if (method === 'accountSignIn') {
        status.signingIn = true;
        return Promise.resolve({ authUrl: `https://auth.example/authorize?n=${calls.length}` });
      }
      return Promise.resolve({ pollAfterSeconds: 60 });
    },
    on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  } as unknown as HostWorker;
  return { worker, status, calls, closed: () => closed };
}

void test('a signed-out server keeps one sign-in waiting and publishes it without a token', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-teams-host-'));
  const fake = fakeWorker();
  const lines: string[] = [];
  const host = new TeamsHost({
    worker: fake.worker,
    root,
    log: (line) => lines.push(line),
    now: () => new Date('2026-10-27T08:00:00Z'),
  });

  const first = await host.check();
  assert.equal(first.signedIn, false);
  assert.equal(first.signInUrl, 'https://auth.example/authorize?n=2');
  assert.deepEqual(await readStatus(root), first);

  // While that sign-in waits, checking again neither replaces it nor logs it again.
  await host.check();
  assert.deepEqual(fake.calls, ['accountStatus', 'accountSignIn', 'accountStatus']);
  assert.equal(lines.filter((line) => line.startsWith('Teams sign-in waiting')).length, 1);

  // A timed-out sign-in is replaced with a new one.
  fake.status.signingIn = false;
  fake.status.message = 'Sign-in timed out. Try again.';
  assert.equal((await host.check()).signInUrl, 'https://auth.example/authorize?n=5');
  assert.ok(lines.includes('Sign-in timed out. Try again.'));

  Object.assign(fake.status, {
    signedIn: true,
    signingIn: false,
    message: null,
    email: 'dana@example.com',
    running: { taskId: 't1', title: 'Write requirements', projectId: 'p1', startedAt: 'now' },
  });
  const signedIn = await host.check();
  assert.equal(signedIn.signInUrl, null);
  assert.equal(signedIn.running?.title, 'Write requirements');
  assert.ok(lines.includes('Signed in to Aiden Teams as dana@example.com on fly-worker.'));
  assert.ok(lines.includes('Working on "Write requirements".'));

  await host.stop();
  assert.equal(fake.closed(), true);
});

void test('only the registered loopback callback is forwarded', () => {
  const ports = [53682, 53683];
  const good = loopbackCallback(
    '  http://127.0.0.1:53683/oauth/callback?code=abc&state=xyz  ',
    ports,
  );
  assert.equal(good.port, '53683');
  for (const pasted of [
    'not a url',
    'https://127.0.0.1:53682/oauth/callback?code=abc&state=xyz',
    'http://localhost:53682/oauth/callback?code=abc&state=xyz',
    'http://127.0.0.1:8080/oauth/callback?code=abc&state=xyz',
    'http://127.0.0.1:53682/other?code=abc&state=xyz',
    'http://127.0.0.1:53682/oauth/callback?code=abc',
    'http://user:pass@127.0.0.1:53682/oauth/callback?code=abc&state=xyz',
  ])
    assert.throws(() => loopbackCallback(pasted, ports), /127\.0\.0\.1/);
});
