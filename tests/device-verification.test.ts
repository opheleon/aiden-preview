import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DeviceTargetSchema,
  DeviceTestSchema,
} from '../packages/contracts/src/device-verification.js';
import { AppiumDevice } from '../packages/verification/src/appium.js';
import { DeviceSession } from '../packages/verification/src/device-session.js';
import { phoneFixture, target } from './device-fixture.js';

void test('phone targets reject remote endpoints, credentials, arbitrary paths and unapproved interactions', () => {
  for (const serverUrl of [
    'not-a-url',
    'https://example.com',
    'http://127.0.0.1:4723/other',
    'http://user:secret@localhost:4723',
    'http://localhost:4723/?key=secret',
  ])
    assert.equal(DeviceTargetSchema.safeParse({ ...target, serverUrl }).success, false);
  assert.equal(
    DeviceTargetSchema.safeParse({ ...target, serverUrl: 'http://localhost:4723/wd/hub' }).success,
    true,
  );
  assert.equal(
    DeviceTestSchema.safeParse({
      name: 'Test',
      target,
      criteria: ['Works'],
      runtime: { provider: 'codex', auth: 'subscription' },
      buildLabel: '42',
      allowInteractions: false,
    }).success,
    false,
  );
});

void test('installed TestFlight app is activated without installing, resetting, or assuming source access', async () => {
  const fixture = phoneFixture();
  const device = new AppiumDevice(target, new AbortController().signal, fixture.http);
  await device.open();
  const caps = fixture.calls[0]!.body.capabilities.alwaysMatch;
  assert.equal(caps['appium:noReset'], true);
  assert.equal(caps['appium:autoLaunch'], false);
  assert.equal(caps['appium:app'], undefined);
  assert.equal(device.metadata.deviceName, 'Fixture iPhone');
  await device.close();
  await device.close();
  assert.equal(fixture.calls.filter((c) => c.method === 'DELETE').length, 1);
  await assert.rejects(async () => device.command('GET', '/source'), /not open/);
});

void test('missing install and unexpected foreground clean up before any app evidence is captured', async () => {
  for (const failure of ['installed', 'foreground']) {
    const fixture = phoneFixture();
    if (failure === 'installed') fixture.state.installed = false;
    else fixture.state.foreground = 'com.apple.Preferences';
    const device = new AppiumDevice(target, new AbortController().signal, fixture.http);
    await assert.rejects(
      device.open(),
      failure === 'installed' ? /Install this app/ : /no longer in front/,
    );
    assert.equal(fixture.calls.at(-1)?.method, 'DELETE');
    assert.equal(
      fixture.calls.some((c) => c.route.endsWith('/screenshot')),
      false,
    );
  }
});

void test('native tools capture steps, reject stale screenshot taps, and preserve screenshot fallback without hierarchy', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-device-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = phoneFixture();
  const device = new AppiumDevice(target, new AbortController().signal, fixture.http);
  await device.open();
  t.after(() => device.close());
  const session = new DeviceSession(device, dir, 9);
  assert.equal(session.definitions().length, 5);
  await session.call('phone_observe', { reason: 'Inspect app' });
  await session.call('phone_tap_point', {
    x: 0.5,
    y: 0.5,
    observationId: 1,
    label: 'Continue',
    reason: 'No unique element',
  });
  const tap = fixture.calls.find((c) => c.body.script === 'mobile: tap');
  assert.deepEqual(tap?.body.args, [{ x: 195, y: 422 }]);
  await assert.rejects(
    session.call('phone_tap_point', {
      x: 0.5,
      y: 0.5,
      observationId: 1,
      label: 'Continue',
      reason: 'Old screenshot',
    }),
    /Observe again/,
  );
  await assert.rejects(
    session.call('phone_tap_point', {
      x: 1.1,
      y: 0.5,
      observationId: 2,
      label: 'Continue',
      reason: 'Outside',
    }),
  );
  await assert.rejects(
    session.call('phone_tap_point', {
      x: 0.5,
      y: 0.5,
      observationId: 2,
      label: 'Buy',
      reason: 'Buy',
    }),
    /manual verification/,
  );
  await session.call('phone_tap', { name: 'Continue', reason: 'Continue' });
  await session.call('phone_type', { name: 'Note', text: 'Example', reason: 'Type' });
  fixture.state.secure = true;
  await session.call('phone_type', { name: 'Password', text: 'not-sent', reason: 'Type' });
  assert.equal(
    fixture.calls.some((c) => c.body.text === 'not-sent'),
    false,
  );
  fixture.state.ambiguous = true;
  await session.call('phone_tap', { name: 'Continue', reason: 'Continue' });
  assert.match(session.observations.at(-1)!.result, /ambiguous/);
  fixture.state.sourceFails = true;
  await session.call('phone_swipe', { direction: 'up', reason: 'Explore' });
  assert.match(await readFile(path.join(dir, 'step-7.xml'), 'utf8'), /unavailable/);
  await session.call('phone_tap', { name: 'Delete', reason: 'Delete' });
  assert.match(session.observations.at(-1)!.result, /manual verification/);
  await session.call('phone_observe', { reason: 'Inspect' });
  await assert.rejects(session.call('phone_observe', { reason: 'Inspect' }), /Step limit/);
  assert.equal(session.exhausted, true);
  await assert.rejects(session.call('shell', {}), /Unknown/);
});

void test('foreground escape stops screenshot capture and serial calls reject concurrent actions', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-device-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = phoneFixture();
  const device = new AppiumDevice(target, new AbortController().signal, fixture.http);
  await device.open();
  t.after(() => device.close());
  const session = new DeviceSession(device, dir, 5);
  const pending = session.call('phone_observe', { reason: 'Inspect' });
  await assert.rejects(session.call('phone_swipe', { direction: 'up', reason: 'Move' }), /Another/);
  await pending;
  fixture.state.foreground = 'other.app';
  await assert.rejects(
    session.call('phone_tap', { name: 'Continue', reason: 'Continue' }),
    /no longer in front/,
  );
  assert.equal(session.observations.length, 1);
});

void test('transport rejects HTTP errors, W3C errors, malformed images and oversized responses', async () => {
  const fixture = phoneFixture();
  let mode = '';
  const http: typeof fetch = (input, options) => {
    if (!mode) return fixture.http(input, options);
    if (mode === 'http') return Promise.resolve(new Response('', { status: 500 }));
    if (mode === 'large') return Promise.resolve(new Response('x'.repeat(12_000_001)));
    return Promise.resolve(
      Response.json({ value: mode === 'w3c' ? { error: 'secret error' } : 'invalid' }),
    );
  };
  const device = new AppiumDevice(target, new AbortController().signal, http);
  await device.open();
  mode = 'http';
  await assert.rejects(device.source(), /HTTP 500/);
  mode = 'w3c';
  await assert.rejects(device.source(), /could not complete/);
  mode = 'large';
  await assert.rejects(device.source(), /evidence limit/);
  mode = 'image';
  await assert.rejects(device.screenshot(), /PNG screenshot/);
  mode = '';
  await device.close();
});
