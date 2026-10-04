import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { atomic } from '../packages/core/src/storage.js';
import { ConnectionManager } from '../packages/integrations/src/index.js';
import { StoredOAuthProvider } from '../packages/integrations/src/oauth.js';
import { oauthCallback } from '../packages/integrations/src/oauth-callback.js';
import { oauthFixture, persistentVault } from './oauth-fixture.js';

void test('synthetic OAuth persists tokens, renews on 401, survives restart, and surfaces revoked consent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-oauth-'));
  const server = await oauthFixture();
  const storage = persistentVault();
  const vault = storage.open();
  let manager = new ConnectionManager(root, { vault });
  try {
    const connection = await manager.add({
      name: 'Synthetic OAuth',
      provider: 'custom',
      url: server.url,
      auth: 'oauth',
    });
    assert.equal(connection.secureStorage, 'session');
    const provider = new StoredOAuthProvider(
      connection,
      vault,
      'http://127.0.0.1/callback',
      'synthetic-state',
    );
    await provider.saveClientInformation({ client_id: 'synthetic-client' });
    await provider.saveCodeVerifier('synthetic-verifier');
    await provider.saveTokens({
      access_token: 'expired',
      refresh_token: server.state.refresh,
      token_type: 'Bearer',
    });
    assert.equal(connection.secureStorage, 'keyring');
    const file = path.join(root, 'integrations', 'connections.json');
    await atomic(file, [connection]);
    const connected = await manager.connect(connection.id);
    assert.equal(connected.authUrl, undefined);
    assert.equal(server.state.refreshes, 1);
    assert.equal((await vault.read(connection.id)).tokens?.refresh_token, 'refresh-2');
    await manager.dispose();
    manager = new ConnectionManager(root, { vault: storage.open() });
    assert.equal((await manager.get(connection.id)).status, 'connected');
    server.state.access = 'expired-on-server';
    assert.deepEqual(await manager.refreshTools(connection.id), []);
    assert.equal(server.state.refreshes, 2);
    assert.equal((await storage.open().read(connection.id)).tokens?.refresh_token, 'refresh-3');
    server.state.lostSession = true;
    const initializations = server.state.initializations;
    assert.deepEqual(await manager.refreshTools(connection.id), []);
    assert.equal(server.state.initializations, initializations + 1);
    storage.state.locked = true;
    server.state.access = 'expired-while-keyring-locked';
    await manager.refreshTools(connection.id);
    assert.equal((await manager.get(connection.id)).secureStorage, 'session');
    storage.state.locked = false;
    server.state.access = 'expired-after-keyring-unlocks';
    await manager.refreshTools(connection.id);
    assert.equal((await manager.get(connection.id)).secureStorage, 'keyring');
    assert.equal((await storage.open().read(connection.id)).tokens?.refresh_token, 'refresh-5');
    server.state.revoked = true;
    server.state.access = 'revoked';
    await assert.rejects(manager.refreshTools(connection.id), /sign-in expired/);
    assert.equal((await manager.get(connection.id)).status, 'failed');
    assert.doesNotMatch(
      await readFile(file, 'utf8'),
      /access-\d|refresh-\d|synthetic-verifier|synthetic-client/,
    );
    const reconnect = await manager.connect(connection.id);
    assert.equal(reconnect.connection.status, 'authorization_required');
    assert.ok(reconnect.authUrl);
    await manager.disconnect(connection.id);
    await manager.dispose();
    manager = new ConnectionManager(root, { vault: storage.open() });
    assert.equal((await manager.get(connection.id)).status, 'disconnected');
  } finally {
    await manager.dispose();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('explicit session-only OAuth stays in memory while legacy default storage uses the OS vault', async () => {
  const storage = persistentVault();
  const vault = storage.open();
  const connection: any = { id: 'session', secureStorage: 'session', sessionOnly: true };
  const provider = new StoredOAuthProvider(connection, vault, 'http://127.0.0.1/callback', 'state');
  await provider.saveClientInformation({ client_id: 'synthetic-client' });
  await provider.saveCodeVerifier('synthetic-verifier');
  await provider.saveTokens({ access_token: 'synthetic-access', token_type: 'Bearer' });
  await provider.invalidateCredentials('verifier');
  assert.equal(connection.secureStorage, 'session');
  assert.equal(storage.records.size, 0);
  assert.deepEqual(await storage.open().read(connection.id), {});
  assert.ok(await provider.tokens());
});

void test('OAuth loopback rejects mismatched state and closes after success, failure, or explicit cancellation', async () => {
  let calls = 0;
  const callback = await oauthCallback(
    'expected',
    (code) => {
      assert.equal(code, 'synthetic');
      calls++;
      return Promise.resolve();
    },
    async () => {},
  );
  assert.equal((await fetch(new URL('/other', callback.url))).status, 404);
  assert.equal((await fetch(`${callback.url}?code=synthetic&state=wrong`)).status, 400);
  assert.equal((await fetch(`${callback.url}?state=expected`)).status, 400);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${callback.url}?code=synthetic&state=expected`)).status, 200);
  assert.equal(calls, 1);
  callback.close();
  const failed = await oauthCallback(
    'expected',
    () => Promise.reject(new Error('synthetic-secret')),
    async () => {},
  );
  const response = await fetch(`${failed.url}?code=synthetic&state=expected`);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /synthetic-secret/);
  failed.close();
  const cancelled = await oauthCallback(
    'expected',
    async () => {},
    async () => {},
  );
  cancelled.close();
  await assert.rejects(fetch(`${cancelled.url}?code=synthetic&state=expected`));
});

void test('OAuth callback expiry runs once and cancellation clears the expiry timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let expired = 0;
  const callback = await oauthCallback(
    'expected',
    async () => {},
    () => {
      expired++;
      return Promise.resolve();
    },
  );
  t.mock.timers.tick(300_000);
  assert.equal(expired, 1);
  callback.close();
  const cancelled = await oauthCallback(
    'expected',
    async () => {},
    () => {
      expired++;
      return Promise.resolve();
    },
  );
  cancelled.close();
  t.mock.timers.tick(300_000);
  assert.equal(expired, 1);
});

void test('OAuth callback consumes state before awaiting token exchange, rejecting replay', async () => {
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const exchange = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const callback = await oauthCallback(
    'expected',
    () => {
      start();
      return exchange;
    },
    () => Promise.resolve(),
  );
  try {
    const first = fetch(`${callback.url}?code=synthetic&state=expected`);
    await started;
    assert.equal((await fetch(`${callback.url}?code=synthetic&state=expected`)).status, 400);
    finish();
    assert.equal((await first).status, 200);
  } finally {
    finish();
    callback.close();
  }
});
