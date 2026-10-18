import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ProjectDeviceTestSchema } from '../packages/contracts/src/device-verification.js';
import { Engine } from '../packages/core/src/engine.js';
import { guideFacts } from '../packages/core/src/guide-context.js';
import { configureGuideVerification, testAppUrl } from '../packages/core/src/guide-verification.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import {
  readAppUrl,
  saveVerificationSettings,
} from '../packages/core/src/verification-settings.js';
import { phoneFixture, target } from './device-fixture.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

void test('setup proves every selected target before saving and ties readiness to the checked configuration', async (t) => {
  const f = await fixture();
  const phone = phoneFixture();
  let httpStatus = 200;
  let offline = false;
  let captureFails = false;
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith(target.serverUrl)
    )
      return captureFails &&
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith('/screenshot')
        ? Promise.resolve(new Response('Synthetic capture unavailable', { status: 500 }))
        : phone.http(input, init);
    requests.push(init ?? {});
    if (offline) return Promise.reject(new Error('Synthetic connection refused'));
    return Promise.resolve(new Response('Synthetic endpoint', { status: httpStatus }));
  });
  const store = new Store(path.join(f.root, 'data'));
  const runtime = new FixtureRuntime(f);
  const e = new Engine(store, runtime);
  t.after(() => e.dispose());
  await atomic(path.join(store.project(f.project.id), 'project.json'), {
    ...f.project,
    repositories: [],
  });
  const update = {
    url: 'http://localhost:5173',
    api: { url: 'http://localhost:5174/api', allowMutations: true },
    phone: ProjectDeviceTestSchema.parse({
      target,
      buildLabel: 'Synthetic build',
      allowInteractions: true,
    }),
  };
  phone.state.installed = false;
  await assert.rejects(
    configureGuideVerification(e, f.project.id, update, true),
    /iPhone access failed/,
  );
  assert.deepEqual(await readAppUrl(e, f.project.id), { url: null });
  phone.state.installed = true;
  captureFails = true;
  await assert.rejects(
    configureGuideVerification(e, f.project.id, update, true),
    /iPhone access failed/,
  );
  assert.deepEqual(
    await readAppUrl(e, f.project.id),
    { url: null },
    'opening an app without capture access is not ready',
  );
  captureFails = false;
  await configureGuideVerification(e, f.project.id, update, false);
  assert.deepEqual(await readAppUrl(e, f.project.id), { url: null }, 'checking alone never saves');
  assert.ok(phone.calls.some((call) => call.body.script === 'mobile: activateApp'));
  assert.ok(
    phone.calls.some((call) => call.method === 'DELETE'),
    'probe releases phone',
  );
  await configureGuideVerification(e, f.project.id, update, true);
  assert.deepEqual((await guideFacts(e, f.project.id)).facts.readyMethods, [
    'code',
    'manual',
    'web',
    'api',
  ]);
  assert.ok(
    requests.every((request) => request.method === 'GET'),
    'access checks never write to APIs',
  );
  assert.equal(runtime.calls.length, 0, 'access probes do not spend model quota');
  await configureGuideVerification(e, f.project.id, { manual: true }, false, f.project);
  await assert.rejects(
    configureGuideVerification(e, f.project.id, { manual: true }, true, {
      ...f.project,
      repositories: [{ ...f.project.repositories[0]!, path: path.join(f.root, 'missing-code') }],
    }),
    /code folder is unavailable/,
  );

  const saved = await readAppUrl(e, f.project.id);
  httpStatus = 401;
  await assert.rejects(
    configureGuideVerification(e, f.project.id, { api: update.api }, true),
    /API:.*HTTP 401/,
  );
  httpStatus = 503;
  await assert.rejects(
    configureGuideVerification(e, f.project.id, update, true),
    /Web app:.*HTTP 503/,
  );
  offline = true;
  await assert.rejects(
    configureGuideVerification(e, f.project.id, update, true),
    /Nothing answered/,
  );
  assert.deepEqual(
    await readAppUrl(e, f.project.id),
    saved,
    'failed rechecks preserve all prior settings',
  );
  offline = false;
  httpStatus = 200;
  await saveVerificationSettings(e, f.project.id, { url: 'http://localhost:9000' });
  assert.ok(
    !(await guideFacts(e, f.project.id)).facts.readyMethods?.includes('web'),
    'changed settings require fresh evidence',
  );
  await configureGuideVerification(
    e,
    f.project.id,
    { url: null, api: null, phone: null, manual: true },
    true,
  );
  await saveVerificationSettings(e, f.project.id, update);
  assert.deepEqual(
    (await guideFacts(e, f.project.id)).facts.readyMethods,
    ['code', 'manual'],
    'removed targets lose old evidence',
  );
  await assert.rejects(testAppUrl('file:///private/fixture'), /http/i);
});
