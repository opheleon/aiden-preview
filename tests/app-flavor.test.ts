import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appFlavor,
  flavorFromEnv,
  isBetaAppVersion,
} from '../packages/contracts/src/app-flavor.js';
import { teamsAuth } from '../packages/contracts/src/teams-auth.js';
import { accountsUrl, dashboardUrl } from '../packages/core/src/accounts/client.js';

void test('only CI-stamped aidenbeta versions are Aiden Beta', () => {
  assert.equal(isBetaAppVersion('1.2.5-aidenbeta.42'), true);
  assert.equal(isBetaAppVersion('1.2.5-aidenbeta.42+build.7'), true);
  for (const version of ['1.2.5', '1.2.5-beta.1', '1.2.5-aidenbeta', 'x1.2.5-aidenbeta.1'])
    assert.equal(isBetaAppVersion(version), false, version);
  assert.equal(appFlavor('1.2.5-aidenbeta.42', true), 'beta');
  assert.equal(appFlavor('1.2.5', true), 'production');
  assert.equal(appFlavor('1.2.5', false), 'local');
});

void test('unknown or missing AIDEN_FLAVOR values stay on production', () => {
  assert.equal(flavorFromEnv({}), 'production');
  assert.equal(flavorFromEnv({ AIDEN_FLAVOR: 'staging' }), 'production');
  assert.equal(flavorFromEnv({ AIDEN_FLAVOR: 'beta' }), 'beta');
  assert.equal(flavorFromEnv({ AIDEN_FLAVOR: 'local' }), 'local');
});

void test('Aiden Beta and local runs sign in to the beta tenant and server, and explicit settings still win', () => {
  const production = teamsAuth({});
  const beta = teamsAuth({ AIDEN_FLAVOR: 'beta' });
  assert.equal(production.issuer, 'https://dev-cbrv8iirno3wazcy.us.auth0.com/');
  assert.equal(beta.issuer, 'https://dev-ojuw8zknxrr27n6o.us.auth0.com/');
  assert.notEqual(beta.clientId, production.clientId);
  assert.equal(beta.audience, production.audience);
  assert.deepEqual(beta.ports, production.ports);
  assert.equal(
    teamsAuth({ AIDEN_FLAVOR: 'beta', AIDEN_AUTH0_CLIENT_ID: 'local' }).clientId,
    'local',
  );
  assert.equal(accountsUrl({}), 'https://api.opheleon.ai');
  assert.equal(accountsUrl({ AIDEN_FLAVOR: 'beta' }), 'https://api-beta.opheleon.ai');
  assert.equal(dashboardUrl({ AIDEN_FLAVOR: 'beta' }), 'https://app-beta.opheleon.ai');
  // A local run from source signs in to beta too, never to production teams.
  assert.equal(teamsAuth({ AIDEN_FLAVOR: 'local' }).issuer, beta.issuer);
  assert.equal(teamsAuth({ AIDEN_FLAVOR: 'local' }).clientId, beta.clientId);
  assert.equal(accountsUrl({ AIDEN_FLAVOR: 'local' }), 'https://api-beta.opheleon.ai');
  assert.equal(
    accountsUrl({ AIDEN_FLAVOR: 'beta', AIDEN_ACCOUNTS_URL: 'http://localhost:8787' }),
    'http://localhost:8787',
  );
});
