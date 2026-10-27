import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  credentialEntry,
  FileCredentialEntry,
} from '../packages/integrations/src/credential-store.js';
import { SecretVault } from '../packages/integrations/src/credentials.js';

void test('file credentials persist across vaults with owner-only files that do not name the entry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-credentials-'));
  const env = { AIDEN_CREDENTIAL_STORE: 'file', AIDEN_HOME: root };
  const entry = (id: string) => credentialEntry('com.opheleon.aiden.accounts', id, env);
  assert.ok(entry('session-a') instanceof FileCredentialEntry);

  assert.equal(
    await new SecretVault(true, entry).write('session-a', { bearer: 'refresh-1' }),
    'keyring',
  );
  assert.deepEqual(await new SecretVault(true, entry).read('session-a'), { bearer: 'refresh-1' });

  const folder = path.join(root, 'credentials');
  const [file] = await readdir(folder);
  assert.match(file!, /^[0-9a-f]{64}\.json$/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(folder, file!))).mode & 0o777, 0o600);
  }
  assert.doesNotMatch(await readFile(path.join(folder, file!), 'utf8'), /session-a|accounts/);

  await new SecretVault(true, entry).remove('session-a');
  assert.deepEqual(await readdir(folder), []);
  assert.deepEqual(await new SecretVault(true, entry).read('session-a'), {});
  assert.equal(await entry('session-a').deleteCredential(), false);
});

void test('file credentials keep services apart and read a corrupt file as absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-credentials-'));
  const mcp = new FileCredentialEntry(root, 'com.opheleon.aiden.mcp', 'same');
  const project = new FileCredentialEntry(root, 'Aiden project credentials', 'same');
  await mcp.setPassword('one');
  assert.equal(await project.getPassword(), undefined);
  assert.equal(await mcp.getPassword(), 'one');

  const [file] = await readdir(path.join(root, 'credentials'));
  await writeFile(path.join(root, 'credentials', file!), '{not json');
  assert.equal(await mcp.getPassword(), undefined);
});

void test('credential store selection refuses unknown values instead of guessing', () => {
  assert.throws(
    () => credentialEntry('service', 'id', { AIDEN_CREDENTIAL_STORE: 'files' }),
    /keyring or file/,
  );
});
