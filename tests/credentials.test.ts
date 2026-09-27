import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { type CredentialEntry, SecretVault } from '../packages/integrations/src/credentials.js';
import { StoredOAuthProvider } from '../packages/integrations/src/oauth.js';

function vaultFixture() {
  let value: string | null = null;
  let failed = false;
  const entry = {
    getPassword() {
      if (failed) return Promise.reject(Error('locked'));
      return Promise.resolve(value);
    },
    setPassword(next: string) {
      if (failed) return Promise.reject(Error('locked'));
      value = next;
      return Promise.resolve();
    },
    deleteCredential() {
      if (failed) return Promise.reject(Error('locked'));
      value = null;
      return Promise.resolve(true);
    },
  };
  const vault = new SecretVault(true, () => entry as CredentialEntry);
  return {
    vault,
    set(value_: string) {
      value = value_;
    },
    fail(value_: boolean) {
      failed = value_;
    },
  };
}

void test('credential vault validates OS data and reports session fallback without leaking mutable references', async () => {
  const f = vaultFixture();
  assert.deepEqual(await f.vault.read('one'), {});
  assert.equal(await f.vault.write('one', { bearer: 'secret' }), 'keyring');
  assert.deepEqual(await f.vault.read('one'), { bearer: 'secret' });
  f.set('{bad');
  assert.deepEqual(await f.vault.read('one'), {});
  f.set('{"bearer":12}');
  assert.deepEqual(await f.vault.read('one'), {});
  f.fail(true);
  assert.equal(await f.vault.write('one', { bearer: 'memory' }), 'session');
  const read = await f.vault.read('one');
  read.bearer = 'changed';
  assert.equal((await f.vault.read('one')).bearer, 'memory');
  await f.vault.remove('one');
  assert.deepEqual(await f.vault.read('one'), {});
  f.fail(false);
  await f.vault.write('one', { bearer: 'temporary' }, true);
  assert.equal((await f.vault.read('one')).bearer, 'temporary');
  await f.vault.write('one', { bearer: 'persistent' });
  await f.vault.remove('one');
  assert.deepEqual(await f.vault.read('one'), {});
  const session = new SecretVault(false);
  await session.write('one', { bearer: 'memory' });
  await session.remove('one');
  assert.deepEqual(await session.read('one'), {});
  await assert.rejects(f.vault.write('one', { bearer: 12 } as any));
});

void test('OAuth state, PKCE, tokens, and client metadata preserve unrelated secrets during invalidation', async () => {
  const vault = new SecretVault(false);
  const connection: any = { id: 'connection', secureStorage: 'session' };
  const provider = new StoredOAuthProvider(
    connection,
    vault,
    'http://127.0.0.1:123/callback',
    'state',
  );
  assert.equal(provider.state(), 'state');
  assert.deepEqual(provider.clientMetadata.redirect_uris, ['http://127.0.0.1:123/callback']);
  assert.equal(await provider.clientInformation(), undefined);
  await assert.rejects(provider.codeVerifier(), /unavailable/);
  await provider.saveClientInformation({ client_id: 'client' });
  assert.equal((await provider.clientInformation())?.client_id, 'client');
  connection.clientId = 'configured';
  assert.equal((await provider.clientInformation())?.client_id, 'configured');
  delete connection.clientId;
  await provider.saveTokens({ access_token: 'token', token_type: 'Bearer' });
  assert.equal((await provider.tokens())?.access_token, 'token');
  await provider.saveCodeVerifier('verifier');
  assert.equal(await provider.codeVerifier(), 'verifier');
  const url = new URL('https://example.com/auth');
  provider.redirectToAuthorization(url);
  assert.equal(provider.authorizationUrl, url);
  await provider.invalidateCredentials('discovery');
  assert.equal(await provider.codeVerifier(), 'verifier');
  await provider.invalidateCredentials('tokens');
  assert.equal(await provider.tokens(), undefined);
  assert.equal(await provider.codeVerifier(), 'verifier');
  await provider.invalidateCredentials('client');
  assert.equal(await provider.clientInformation(), undefined);
  await provider.invalidateCredentials('verifier');
  await assert.rejects(provider.codeVerifier());
  await provider.invalidateCredentials('all');
  assert.deepEqual(await vault.read(connection.id), {});
});

void test('production credential adapter treats a nonexistent test identity as signed out', async () => {
  const vault = new SecretVault();
  // Random identity only: no existing account is queried and nothing is written to the OS store.
  assert.deepEqual(await vault.read(`aiden-missing-test-${randomUUID()}`), {});
});
