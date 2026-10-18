import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { VerificationConfigSchema } from '../packages/contracts/src/verification.js';
import { atomic } from '../packages/core/src/storage.js';
import { verificationAccessKeys } from '../packages/core/src/verification-access.js';
import { updatedVerificationConfig } from '../packages/core/src/verification-auth-settings.js';
import { ConnectionManager } from '../packages/integrations/src/index.js';
import { loadVerificationConfig } from '../packages/verification/src/policy.js';
import {
  forgetProjectCredentials,
  persistProjectVerification,
  projectCredentialEntries,
  readProjectVerification,
} from '../packages/verification/src/project-credentials.js';
import { persistentVault } from './oauth-fixture.js';

const privateConfig = VerificationConfigSchema.parse({
  url: 'https://fixture.invalid/app',
  webLogin: { loginUrl: 'https://fixture.invalid/login', successText: 'Your notes' },
  credentials: { username: 'fixture-account', password: 'private-fixture-password' },
  credentialOrigin: 'https://fixture.invalid',
  api: { url: 'https://fixture.invalid/api/', keyHeader: 'X-API-Key', allowMutations: false },
  apiKey: { origin: 'https://fixture.invalid', value: 'private-fixture-api-key' },
  expiredToken: 'expired-fixture-token',
});

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aiden-credential-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const records = new Map<string, string>();
  const state = { reads: 0, writes: 0, deletes: 0, locked: false, refuseDelete: false };
  t.mock.method(projectCredentialEntries, 'create', (id: string) => ({
    getPassword: () => {
      state.reads++;
      return Promise.resolve(records.get(id));
    },
    setPassword: (value: string) => {
      state.writes++;
      if (state.locked) return Promise.reject(new Error('Synthetic secret-bearing native failure'));
      records.set(id, value);
      return Promise.resolve();
    },
    deleteCredential: () => {
      state.deletes++;
      if (state.refuseDelete) return Promise.resolve(false);
      return Promise.resolve(records.delete(id));
    },
  }));
  return {
    dir,
    records,
    state,
    file: path.join(dir, 'verification.json'),
    id: createHash('sha256').update(dir).digest('hex'),
  };
}

void test('legacy credentials migrate once, remain usable, and disappear from public settings on disk', async (t) => {
  const f = await fixture(t);
  await atomic(f.file, privateConfig);
  const [first, second] = await Promise.all([
    readProjectVerification(f.dir),
    readProjectVerification(f.dir),
  ]);
  assert.deepEqual(first.credentials, privateConfig.credentials);
  assert.deepEqual(second.apiKey, privateConfig.apiKey);
  assert.equal(first.credentialStorage, 'keyring');
  assert.equal(first.credentialOrigin, privateConfig.credentialOrigin);
  assert.equal(f.state.writes, 1);
  const publicText = await readFile(f.file, 'utf8');
  for (const value of [
    'fixture-account',
    'private-fixture-password',
    'private-fixture-api-key',
    'expired-fixture-token',
  ])
    assert.ok(!publicText.includes(value));
  assert.match(f.records.get(f.id)!, /private-fixture-password/);
  await persistProjectVerification(f.dir, {
    ...first,
    trigger: 'after_assessment',
    rememberCredentials: true,
  });
  assert.equal(f.state.writes, 1, 'public changes do not trigger another native write');
  await persistProjectVerification(f.dir, privateConfig);
  assert.equal((await readProjectVerification(f.dir)).credentialStorage, 'keyring');
  assert.equal(f.state.writes, 1);
  await forgetProjectCredentials(f.dir);
  assert.equal(f.records.size, 0);
});

void test('native credentials reload from metadata without exposing values and malformed payloads are sanitized', async (t) => {
  const f = await fixture(t);
  await atomic(f.file, { url: privateConfig.url, credentialStorage: 'keyring' });
  f.records.set(
    f.id,
    JSON.stringify({ bearer: JSON.stringify({ credentials: privateConfig.credentials }) }),
  );
  assert.deepEqual((await readProjectVerification(f.dir)).credentials, privateConfig.credentials);
  await readProjectVerification(f.dir);
  assert.equal(f.state.reads, 1);
  const corrupt = path.join(f.dir, 'corrupt');
  const id = createHash('sha256').update(corrupt).digest('hex');
  await atomic(path.join(corrupt, 'verification.json'), { credentialStorage: 'keyring' });
  f.records.set(id, JSON.stringify({ bearer: '{private-corrupt-value' }));
  const invalid = await readProjectVerification(corrupt);
  assert.equal(invalid.credentials, undefined);
  assert.ok(!JSON.stringify(invalid).includes('private-corrupt-value'));
  await forgetProjectCredentials(corrupt);
  assert.ok(!f.records.has(id));
});

void test('explicit session-only credentials never access native storage and are unavailable after a fresh load', async (t) => {
  const f = await fixture(t);
  await persistProjectVerification(f.dir, { ...privateConfig, rememberCredentials: false });
  assert.equal(
    (await readProjectVerification(f.dir)).credentials?.password,
    privateConfig.credentials!.password,
  );
  assert.equal(f.state.writes, 0);
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.credentialStorage, 'session');
  assert.equal(saved.credentials, undefined);
  const fresh = path.join(f.dir, 'fresh-worker');
  await atomic(path.join(fresh, 'verification.json'), saved);
  assert.equal((await readProjectVerification(fresh)).credentials, undefined);
  assert.equal(f.state.reads, 0, 'session metadata never tries the native store');
  await forgetProjectCredentials(f.dir);
  assert.equal((await readProjectVerification(f.dir)).apiKey, undefined);
  assert.equal(f.state.deletes, 0);
});

void test('unavailable secure storage falls back to memory without retaining legacy plaintext', async (t) => {
  const f = await fixture(t);
  f.state.locked = true;
  await atomic(f.file, privateConfig);
  const result = await readProjectVerification(f.dir);
  assert.equal(result.credentialStorage, 'session');
  assert.deepEqual(result.credentials, privateConfig.credentials);
  assert.ok(!(await readFile(f.file, 'utf8')).includes(privateConfig.credentials!.password));
  await forgetProjectCredentials(f.dir);
  assert.equal((await readProjectVerification(f.dir)).credentials, undefined);
});

void test('removing web login or API settings removes only the credentials that are no longer needed', async (t) => {
  const f = await fixture(t);
  await persistProjectVerification(f.dir, privateConfig);
  const noWeb = updatedVerificationConfig(await readProjectVerification(f.dir), { webLogin: null });
  await persistProjectVerification(f.dir, noWeb);
  const apiOnly = await readProjectVerification(f.dir);
  assert.equal(apiOnly.credentials, undefined);
  assert.deepEqual(apiOnly.apiKey, privateConfig.apiKey);
  assert.ok(!f.records.get(f.id)!.includes(privateConfig.credentials!.password));
  await persistProjectVerification(f.dir, updatedVerificationConfig(apiOnly, { api: null }));
  assert.equal(f.records.size, 0);
  const empty = await readProjectVerification(f.dir);
  assert.equal(empty.apiKey, undefined);
  assert.equal(empty.expiredToken, undefined);
  assert.equal(empty.credentialStorage, undefined);
  await persistProjectVerification(f.dir, privateConfig);
  await persistProjectVerification(
    f.dir,
    updatedVerificationConfig(await readProjectVerification(f.dir), { api: null }),
  );
  assert.deepEqual((await readProjectVerification(f.dir)).credentials, privateConfig.credentials);
  assert.ok(!f.records.get(f.id)!.includes(privateConfig.apiKey!.value));
});

void test('changing origins clears old secrets and disabling remembering removes the native record', async (t) => {
  const f = await fixture(t);
  const changed = updatedVerificationConfig(privateConfig, {
    url: 'https://other.invalid/app',
    webLogin: { loginUrl: 'https://other.invalid/login', successText: 'Notes' },
    api: { ...privateConfig.api!, url: 'https://other.invalid/api/' },
  });
  assert.equal(changed.credentials, undefined);
  assert.equal(changed.apiKey, undefined);
  await persistProjectVerification(f.dir, privateConfig);
  await persistProjectVerification(f.dir, {
    ...(await readProjectVerification(f.dir)),
    rememberCredentials: false,
  });
  assert.equal(f.records.size, 0);
  assert.equal((await readProjectVerification(f.dir)).credentialStorage, 'session');
  assert.deepEqual((await readProjectVerification(f.dir)).credentials, privateConfig.credentials);
});

void test('locked or unconfirmed removal preserves cleanup metadata and can be retried without leaking native errors', async (t) => {
  const f = await fixture(t);
  await persistProjectVerification(f.dir, privateConfig);
  const before = await readFile(f.file, 'utf8');
  f.state.locked = true;
  await assert.rejects(forgetProjectCredentials(f.dir), (error: Error) => {
    assert.match(error.message, /Could not remove saved credentials/);
    assert.equal(error.cause, undefined);
    assert.ok(!error.message.includes('secret-bearing'));
    return true;
  });
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.deepEqual((await readProjectVerification(f.dir)).apiKey, privateConfig.apiKey);
  f.state.locked = false;
  f.state.refuseDelete = true;
  await assert.rejects(forgetProjectCredentials(f.dir), /Could not remove/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  f.state.refuseDelete = false;
  await forgetProjectCredentials(f.dir);
  await forgetProjectCredentials(f.dir);
  assert.equal(f.records.size, 0);
  const cleared = await loadVerificationConfig(f.dir, {
    AIDEN_VERIFY_USERNAME: 'env-user',
    AIDEN_VERIFY_PASSWORD: 'env-password',
  });
  assert.equal(cleared.credentials, undefined);
  assert.equal(cleared.credentialsForgotten, true);
  const reentered = updatedVerificationConfig(cleared, {
    webCredentials: privateConfig.credentials!,
  });
  assert.equal(reentered.credentialsForgotten, undefined);
});

void test('a failed metadata commit leaves a cleanup marker so an orphan native record can be forgotten', async (t) => {
  const f = await fixture(t);
  // A directory at the destination makes the final atomic rename fail after native storage succeeds.
  const original = projectCredentialEntries.create.bind(projectCredentialEntries);
  t.mock.method(projectCredentialEntries, 'create', (id: string) => {
    const entry = original(id);
    return {
      ...entry,
      setPassword: async (value: string) => {
        await entry.setPassword(value);
        if (value !== '{}') await mkdir(f.file);
      },
    };
  });
  await assert.rejects(persistProjectVerification(f.dir, privateConfig));
  assert.equal(f.records.size, 1);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.dir, 'verification-credential-state.json'), 'utf8')),
    { keyring: true },
  );
  await rm(f.file, { recursive: true });
  await forgetProjectCredentials(f.dir);
  assert.equal(f.records.size, 0);
});

void test('legacy permissive files are rejected before native access and empty projects do not prompt', async (t) => {
  const f = await fixture(t);
  await readProjectVerification(f.dir);
  assert.equal(f.state.reads + f.state.writes, 0);
  await atomic(f.file, privateConfig);
  await chmod(f.file, 0o644);
  await assert.rejects(readProjectVerification(f.dir), /chmod 600/);
  assert.equal(f.state.writes, 0);
});

void test('shared integration removal keeps its metadata on deletion failure and succeeds after unlocking', async (t) => {
  const f = await fixture(t);
  const native = persistentVault();
  const manager = new ConnectionManager(f.dir, { vault: native.open() });
  const connection = await manager.add({
    name: 'Synthetic shared connection',
    provider: 'custom',
    url: 'https://fixture.invalid/mcp',
    auth: 'bearer',
    bearer: 'shared-fixture-secret',
  });
  await persistProjectVerification(f.dir, privateConfig);
  await forgetProjectCredentials(f.dir);
  assert.equal((await manager.list()).length, 1);
  assert.equal((await native.open().read(connection.id)).bearer, 'shared-fixture-secret');
  native.state.locked = true;
  await assert.rejects(manager.remove(connection.id), /Could not remove/);
  assert.equal((await manager.list()).length, 1);
  native.state.locked = false;
  await manager.remove(connection.id);
  assert.equal((await manager.list()).length, 0);
  assert.equal(native.records.size, 0);
});

void test('expired session credentials invalidate previously confirmed setup access', () => {
  const settings = {
    url: privateConfig.url!,
    webLogin: privateConfig.webLogin!,
    api: privateConfig.api!,
    webCredentialsConfigured: true,
    apiKeyConfigured: true,
  };
  const checked = verificationAccessKeys(settings);
  const expired = verificationAccessKeys({
    ...settings,
    webCredentialsConfigured: false,
    apiKeyConfigured: false,
  });
  assert.notEqual(expired.web, checked.web);
  assert.notEqual(expired.api, checked.api);
});
