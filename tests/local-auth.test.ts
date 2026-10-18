import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { VerificationConfigSchema } from '../packages/contracts/src/verification.js';
import { Engine } from '../packages/core/src/engine.js';
import { configureGuideVerification } from '../packages/core/src/guide-verification.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import { updatedVerificationConfig } from '../packages/core/src/verification-auth-settings.js';
import { readAppUrl } from '../packages/core/src/verification-settings.js';
import { ToolObservation } from '../packages/tools/src/mcp.js';
import { privateBrowserLogin } from '../packages/verification/src/browser-login.js';
import {
  ApiHttp,
  ApiSession,
  BrowserSession,
  launchBrowser,
  loadVerificationConfig,
  redactor,
  settingsFile,
} from '../packages/verification/src/index.js';
import { configuredApiKey } from '../packages/verification/src/policy.js';
import { demoAccount, startAuthDemo } from '../scripts/local-auth-demo/server.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

void test('real local login and API checks reject bad access before saving and keep credentials private', async (t) => {
  const f = await fixture();
  const demo = await startAuthDemo(path.join(f.root, 'demo'));
  const store = new Store(path.join(f.root, 'data'));
  const runtime = new FixtureRuntime(f);
  const engine = new Engine(store, runtime);
  t.after(async () => {
    await engine.dispose();
    await demo.close();
  });
  await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
  const web = {
    url: `${demo.origin}/app`,
    webLogin: { loginUrl: `${demo.origin}/login` },
    webCredentials: { username: demoAccount.email, password: demoAccount.password },
  };
  const api = {
    api: { url: `${demo.origin}/api/`, allowMutations: true, keyHeader: 'X-API-Key' as const },
    apiKey: demoAccount.apiKey,
  };
  await assert.rejects(
    configureGuideVerification(
      engine,
      f.project.id,
      { ...web, webCredentials: { ...web.webCredentials, password: 'wrong' } },
      true,
    ),
    /Could not verify sign-in/,
  );
  await assert.rejects(
    configureGuideVerification(engine, f.project.id, { ...api, apiKey: 'wrong' }, true),
    /rejected this key/,
  );
  await assert.rejects(
    configureGuideVerification(engine, f.project.id, { api: api.api }, true),
    /API key/i,
  );
  assert.deepEqual(await readAppUrl(engine, f.project.id), { url: null });
  await configureGuideVerification(engine, f.project.id, { ...web, ...api }, false);
  assert.deepEqual(await readAppUrl(engine, f.project.id), { url: null });
  await configureGuideVerification(engine, f.project.id, { ...web, ...api }, true);
  const publicSettings = await readAppUrl(engine, f.project.id);
  assert.equal(publicSettings.webCredentialsConfigured, true);
  assert.equal(publicSettings.apiKeyConfigured, true);
  assert.ok(!JSON.stringify(publicSettings).includes(demoAccount.password));
  assert.ok(!JSON.stringify(publicSettings).includes(demoAccount.apiKey));
  assert.equal((await stat(settingsFile(store.project(f.project.id)))).mode & 0o777, 0o600);
  const saved = await loadVerificationConfig(store.project(f.project.id), {});
  const disabled = updatedVerificationConfig(saved, { url: null });
  assert.equal(disabled.webLogin, undefined);
  assert.equal(disabled.credentials, undefined);
  assert.equal(disabled.credentialOrigin, undefined);
  assert.equal(updatedVerificationConfig(saved, { webLogin: null }).credentials, undefined);
  assert.throws(
    () =>
      configuredApiKey(
        updatedVerificationConfig(saved, {
          api: { ...api.api, url: 'http://localhost:9999/api/' },
        }),
      ),
    /key/i,
  );
  assert.throws(
    () =>
      updatedVerificationConfig(saved, {
        webLogin: { ...web.webLogin, loginUrl: 'http://localhost:9999/login' },
      }),
    /same origin/,
  );
  assert.equal(
    runtime.calls.length,
    0,
    'real access checks do not invoke the synthetic model runtime',
  );
});

void test('private login transfers a cookie into real Aiden browser tools and database writes survive sessions', async (t) => {
  const f = await fixture();
  const folder = path.join(f.root, 'demo');
  const demo = await startAuthDemo(folder);
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await demo.close();
  });
  const config = VerificationConfigSchema.parse({
    url: `${demo.origin}/app`,
    webLogin: { loginUrl: `${demo.origin}/login` },
    credentials: { username: demoAccount.email, password: demoAccount.password },
    credentialOrigin: demo.origin,
  });
  const state = await privateBrowserLogin(browser, new URL(config.url!), config);
  assert.deepEqual(state.origins, []);
  const dir = path.join(f.root, 'proof');
  await mkdir(dir);
  const session = await BrowserSession.open(browser, {
    start: new URL(config.url!),
    storageState: state,
    signIn: () => privateBrowserLogin(browser, new URL(config.url!), config),
    allowedOrigins: [],
    stepLimit: 15,
    dir,
    criterion: 'Save a note',
    redact: redactor([demoAccount.password]),
  });
  const observed: unknown[] = [];
  try {
    assert.ok(!session.definitions().some((tool) => tool.name === 'browser_type_credential'));
    const text = "A real database note <script>alert('x')</script> ' OR 1=1 --";
    for (const [name, input] of [
      ['browser_type', { role: 'textbox', name: 'New note', text }],
      ['browser_click', { role: 'button', name: 'Save note' }],
      ['page_check', { role: 'text', name: text, state: 'visible' }],
    ] as const) {
      const observation = await session.call(name, {
        ...input,
        reason: 'Verify local database-backed notes',
      });
      assert.ok(observation instanceof ToolObservation);
      observed.push(observation.text);
    }
    assert.equal(session.checks.at(-1)?.passed, true);
    assert.equal(demo.db.notes(demo.db.apiUser(demoAccount.apiKey)!)[0]?.text, text);
    const fresh = await browser.newContext({ storageState: state });
    try {
      const page = await fresh.newPage();
      await page.goto(config.url!);
      assert.equal(await page.getByText(text, { exact: true }).count(), 1);
      assert.equal(await page.locator('input[type=password]').count(), 0);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL(`${demo.origin}/login`);
      assert.equal(demo.db.user(state.cookies[0]!.value), null);
    } finally {
      await fresh.close();
    }
    await session.call('browser_navigate', { url: config.url!, reason: 'Return after sign-out' });
    assert.equal(await session.page.locator('input[type=password]').count(), 1);
    await assert.rejects(
      session.call('browser_sign_in', {
        reason: 'Wrong destination',
        url: 'https://other.invalid',
      }),
      /Unrecognized key/,
    );
    for (let retry = 0; retry < 2; retry++) {
      const signedIn = await session.call('browser_sign_in', { reason: 'Sign in again privately' });
      assert.ok(signedIn instanceof ToolObservation);
      observed.push(signedIn.text);
      assert.match(signedIn.text, /verified authenticated access/);
      assert.equal(await session.page.locator('input[type=password]').count(), 0);
      assert.equal(await session.page.getByText(text, { exact: true }).count(), 1);
      const signedOut = await session.call('browser_click', {
        role: 'button',
        name: 'Sign out',
        reason: 'Test repeated sign-in',
      });
      assert.ok(signedOut instanceof ToolObservation);
      observed.push(signedOut.text);
    }
    const output = JSON.stringify({ observed, steps: session.steps, checks: session.checks });
    for (const secret of [demoAccount.password, demoAccount.apiKey, state.cookies[0]!.value])
      assert.ok(
        !output.includes(secret),
        'model-visible observations and evidence omit private values',
      );
    const database = await readFile(path.join(folder, 'demo.sqlite'));
    assert.ok(!database.includes(Buffer.from(demoAccount.password)));
    assert.ok(!database.includes(Buffer.from(state.cookies[0]!.value)));
  } finally {
    await session.close();
  }
  assert.equal((await fetch(config.url!, { redirect: 'manual' })).status, 303);
  assert.equal(
    (
      await fetch(`${demo.origin}/notes`, {
        method: 'POST',
        headers: { Origin: 'https://other.invalid' },
        body: 'text=test',
      })
    ).status,
    403,
  );
  await assert.rejects(
    privateBrowserLogin(browser, new URL('http://localhost:9999/app'), config),
    /different app origin/,
  );
  await assert.rejects(
    privateBrowserLogin(browser, new URL(config.url!), { ...config, credentials: undefined }),
    /private test username/,
  );
});

void test('API key tools test rejection, write real notes, redact echoes, and enforce header-only scoped access', async (t) => {
  const f = await fixture();
  const demo = await startAuthDemo(path.join(f.root, 'demo'));
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await demo.close();
  });
  const http = new ApiHttp(
    `${demo.origin}/api/`,
    true,
    new AbortController().signal,
    undefined,
    undefined,
    { value: demoAccount.apiKey, header: 'X-API-Key' },
  );
  const request = {
    method: 'GET' as const,
    path: 'notes',
    body: null,
    bearer: null,
    reason: 'Verify API key access',
  };
  assert.equal((await http.request(request)).status, 401);
  assert.equal((await http.request({ ...request, bearer: 'invalid-test-token' })).status, 401);
  const authenticated = await http.request({ ...request, bearer: '@secret:apiKey' });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.authenticationHeader, 'X-API-Key');
  assert.equal(authenticated.cookiesSent, false);
  assert.equal(http.receipts[0]?.authenticationHeader, null);
  assert.ok(!JSON.stringify(authenticated).includes(demoAccount.apiKey));
  await assert.rejects(
    http.request({
      ...request,
      method: 'POST',
      bearer: '@secret:apiKey',
      body: JSON.stringify({ text: '@secret:apiKey' }),
    }),
    /only be sent/,
  );
  await assert.rejects(
    http.request({ ...request, path: 'http://localhost:9999/api/', bearer: '@secret:apiKey' }),
    /outside/,
  );
  await assert.rejects(
    http.request({ ...request, path: '../login', bearer: '@secret:apiKey' }),
    /outside/,
  );
  await assert.rejects(
    http.request({ ...request, bearer: '@secret:username' }),
    /configured API key/,
  );
  const readOnly = new ApiHttp(
    `${demo.origin}/api/`,
    false,
    new AbortController().signal,
    undefined,
    undefined,
    { value: demoAccount.apiKey, header: 'Authorization' },
  );
  const bearerReceipt = await readOnly.request({ ...request, bearer: '@secret:apiKey' });
  assert.equal(bearerReceipt.status, 200);
  assert.equal(bearerReceipt.authenticationHeader, 'Authorization');
  await assert.rejects(
    readOnly.request({
      ...request,
      method: 'POST',
      body: '{"text":"no"}',
      bearer: '@secret:apiKey',
    }),
    /writes are disabled/,
  );
  const dir = path.join(f.root, 'api-proof');
  await mkdir(dir);
  const session = await ApiSession.open(browser, http, dir, 'Save API note', 15);
  try {
    assert.ok(
      !session
        .definitions()
        .some((tool) => ['api_identity', 'api_tamper_token'].includes(tool.name)),
    );
    await session.call('api_request', {
      ...request,
      method: 'POST',
      body: JSON.stringify({ text: demoAccount.apiKey }),
      bearer: '@secret:apiKey',
    });
    await session.call('api_request', { ...request, bearer: '@secret:apiKey' });
    assert.equal(http.receipts.at(-1)?.status, 200);
    assert.equal(demo.db.notes(demo.db.apiUser(demoAccount.apiKey)!)[0]?.text, demoAccount.apiKey);
    assert.ok(
      !JSON.stringify({ receipts: http.receipts, steps: session.steps }).includes(
        demoAccount.apiKey,
      ),
    );
  } finally {
    await session.close();
  }
});
