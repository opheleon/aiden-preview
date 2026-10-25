import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { teamsAuth } from '../packages/contracts/src/teams-auth.js';
import { TeamsSignIn } from '../packages/core/src/accounts/oidc.js';
import { AccountSession } from '../packages/core/src/accounts/session.js';
import { Store } from '../packages/core/src/storage.js';

const issuer = 'https://tenant.example/';

/** A sign-in on unused test ports with a scripted Auth0 token endpoint. */
async function setup(ports = [39871, 39872]) {
  const store = new Store(await mkdtemp(path.join(tmpdir(), 'aiden-oidc-')));
  const session = new AccountSession(store);
  const requests: { url: string; body: Record<string, string> }[] = [];
  let now = 1_000_000;
  let issued = 0;
  let refreshStatus = 200;
  // eslint-disable-next-line @typescript-eslint/require-await -- fetch stand-in must return a promise like fetch does
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = url instanceof Request ? url.url : url.toString();
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
      string,
      string
    >;
    requests.push({ url: href, body });
    if (href.endsWith('/oauth/revoke')) return new Response('{}', { status: 200 });
    if (body.grant_type === 'refresh_token' && refreshStatus !== 200)
      return new Response('{"error":"invalid_grant"}', { status: refreshStatus });
    issued += 1;
    return new Response(
      JSON.stringify({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: 900,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const signIn = new TeamsSignIn(
    { issuer, clientId: 'desktop', audience: 'https://api.example', ports },
    session,
    http,
    () => now,
  );
  return {
    session,
    signIn,
    requests,
    advance: (ms: number) => (now += ms),
    rejectRefresh: (status: number) => (refreshStatus = status),
  };
}

/** Play the browser: follow the redirect back to the loopback listener. */
async function redirect(authUrl: string, query: Record<string, string>): Promise<Response> {
  const url = new URL(authUrl);
  const back = new URL(url.searchParams.get('redirect_uri') ?? '');
  back.search = new URLSearchParams(query).toString();
  return fetch(back);
}

/** Wait until the background exchange settles. */
async function settled(signIn: TeamsSignIn): Promise<void> {
  for (let i = 0; i < 100 && signIn.progress().waiting; i++)
    await new Promise((r) => setTimeout(r, 10));
}

void test('browser sign-in uses PKCE and the loopback port, then keeps only the refresh token', async () => {
  const f = await setup();
  const { authUrl } = await f.signIn.begin();
  const url = new URL(authUrl);
  assert.equal(url.origin + url.pathname, `${issuer}authorize`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client_id'), 'desktop');
  assert.equal(url.searchParams.get('audience'), 'https://api.example');
  assert.equal(url.searchParams.get('resource'), 'https://api.example');
  assert.match(url.searchParams.get('scope') ?? '', /offline_access/);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:39871/oauth/callback');
  assert.equal(f.signIn.progress().waiting, true);
  assert.equal((await redirect(authUrl, { code: 'abc', state: 'wrong' })).status, 404);
  const page = await redirect(authUrl, { code: 'abc', state: url.searchParams.get('state') ?? '' });
  assert.match(await page.text(), /signed in to Aiden Teams/);
  await settled(f.signIn);
  const exchange = f.requests.find((r) => r.body.grant_type === 'authorization_code');
  assert.equal(exchange?.body.code, 'abc');
  assert.equal(exchange?.body.resource, 'https://api.example');
  assert.ok((exchange?.body.code_verifier ?? '').length >= 43, 'sends the PKCE verifier');
  assert.equal(await f.session.refreshToken(), 'refresh-1');
  assert.equal(await f.signIn.accessToken(), 'access-1');
  assert.deepEqual(f.signIn.progress(), { waiting: false, failure: null });
});

void test('a cancelled sign-in says so and stores nothing', async () => {
  const f = await setup([39873, 39874]);
  const { authUrl } = await f.signIn.begin();
  const state = new URL(authUrl).searchParams.get('state') ?? '';
  await redirect(authUrl, { error: 'access_denied', state });
  await settled(f.signIn);
  assert.deepEqual(f.signIn.progress(), { waiting: false, failure: 'Sign-in was cancelled.' });
  assert.equal(await f.session.refreshToken(), undefined);
});

void test('the second registered port is used when the first is busy', async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(39875, '127.0.0.1', resolve));
  try {
    const f = await setup([39875, 39876]);
    const { authUrl } = await f.signIn.begin();
    assert.equal(
      new URL(authUrl).searchParams.get('redirect_uri'),
      'http://127.0.0.1:39876/oauth/callback',
    );
    await f.signIn.signOut();
  } finally {
    blocker.close();
  }
});

void test('expired access tokens refresh once for concurrent callers and rotate the refresh token', async () => {
  const f = await setup([39877, 39878]);
  await f.session.saveRefresh('refresh-0');
  const tokens = await Promise.all([
    f.signIn.accessToken(),
    f.signIn.accessToken(),
    f.signIn.accessToken(),
  ]);
  assert.deepEqual(new Set(tokens), new Set(['access-1']));
  assert.equal(f.requests.filter((r) => r.body.grant_type === 'refresh_token').length, 1);
  assert.equal(f.requests[0]?.body.refresh_token, 'refresh-0');
  assert.equal(f.requests[0]?.body.resource, 'https://api.example');
  assert.equal(await f.session.refreshToken(), 'refresh-1');
  f.advance(14 * 60 * 1000 + 1);
  assert.equal(await f.signIn.accessToken(), 'access-2', 'refreshes a minute before expiry');
  f.signIn.invalidate();
  assert.equal(await f.signIn.accessToken(), 'access-3');
});

void test('a rejected refresh token signs out; sign-out revokes at Auth0', async () => {
  const f = await setup([39879, 39880]);
  await f.session.saveRefresh('refresh-0');
  f.rejectRefresh(403);
  assert.equal(await f.signIn.accessToken(), undefined);
  assert.equal(await f.session.refreshToken(), undefined);
  assert.match(f.signIn.progress().failure ?? '', /sign-in ended \(Auth0: invalid_grant\)/);
  await f.session.saveRefresh('refresh-9');
  await f.signIn.signOut();
  const revoke = f.requests.find((r) => r.url.endsWith('/oauth/revoke'));
  assert.deepEqual(revoke?.body, { client_id: 'desktop', token: 'refresh-9' });
  assert.equal(await f.session.refreshToken(), undefined);
});

void test('the Teams tenant must be HTTPS', () => {
  assert.equal(teamsAuth({}).issuer, 'https://dev-cbrv8iirno3wazcy.us.auth0.com/');
  assert.equal(teamsAuth({ AIDEN_AUTH0_CLIENT_ID: 'other' }).clientId, 'other');
  assert.throws(() => teamsAuth({ AIDEN_AUTH0_ISSUER: 'http://tenant.example/' }), /HTTPS/);
  assert.throws(() => teamsAuth({ AIDEN_AUTH0_ISSUER: 'https://tenant.example' }), /HTTPS/);
});
