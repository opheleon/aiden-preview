import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PhoneConnectionSetup } from '../packages/core/src/phone-setup.js';
import { ManagedAppium } from '../packages/verification/src/managed-appium.js';
import { parsePhoneApps, parsePhones } from '../packages/verification/src/phone-discovery.js';

const udid = '00008110-0011223344556677';
void test('discovery ignores simulators and malformed rows while exposing pairing and build metadata', () => {
  const row = {
    hardwareProperties: { udid, deviceType: 'iPhone' },
    deviceProperties: {
      name: 'Fixture phone',
      osVersionNumber: '18',
      developerModeStatus: 'enabled',
    },
    connectionProperties: { pairingState: 'paired' },
  };
  const phones = parsePhones({
    result: {
      devices: [
        row,
        {},
        { ...row, hardwareProperties: { udid: 'simulator', deviceType: 'iPhone' } },
      ],
    },
  });
  assert.equal(phones.length, 1);
  assert.equal(phones[0]?.udid, udid);
  assert.match(phones[0].state, /Paired/);
  assert.match(
    parsePhones({
      result: {
        devices: [
          {
            ...row,
            deviceProperties: { ...row.deviceProperties, developerModeStatus: 'disabled' },
          },
        ],
      },
    })[0]!.state,
    /Developer Mode/,
  );
  assert.deepEqual(
    parsePhoneApps({
      result: {
        apps: [
          {
            bundleIdentifier: 'com.example.notes',
            name: 'Notes',
            version: '1.2',
            bundleVersion: '42',
          },
          { bundleIdentifier: '--arbitrary', name: 'Invalid' },
        ],
      },
    }),
    [{ bundleId: 'com.example.notes', name: 'Notes', version: '1.2', build: '42' }],
  );
  assert.throws(() => parsePhoneApps({ result: {} }));
});

void test('shared setup survives project changes and reports each missing prerequisite without raw errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phone-setup-test-'));
  try {
    const setup = new PhoneConnectionSetup(
      root,
      (_binary, args) => {
        if (args[0] === 'driver') return Promise.resolve('{"xcuitest":{"version":"fixture"}}');
        return Promise.resolve('fixture');
      },
      () => Promise.resolve([{ udid, name: 'Synthetic phone', version: '18', state: 'Paired' }]),
    );
    await setup.save({ teamId: 'ABCDE12345', runnerBundleId: 'com.example.Runner' });
    assert.ok((await setup.inspect()).checks.every((c) => c.ready));
    assert.equal((await new PhoneConnectionSetup(root).read()).teamId, 'ABCDE12345');
    await assert.rejects(setup.save({ teamId: 'bad', password: 'secret' }));
    const missing = new PhoneConnectionSetup(
      root,
      () => Promise.reject(new Error('private secret')),
      () => Promise.reject(new Error('private')),
    );
    const status = await missing.inspect();
    assert.ok(status.checks.every((c) => !c.ready));
    assert.doesNotMatch(JSON.stringify(status), /private secret/);
    await setup.save({});
    assert.deepEqual(await setup.read(), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('owned Appium lifecycle uses an isolated config, strips secrets, closes its server and cancels startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'managed-appium-test-'));
  const oldPath = process.env.PATH;
  const oldKey = process.env.OPENAI_API_KEY;
  const evidence = path.join(root, 'fixture.json');
  const server = new ManagedAppium();
  try {
    await writeFile(
      path.join(root, 'appium'),
      `#!${process.execPath}
const fs = require('node:fs');
const http = require('node:http');
const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ config, secret: process.env.OPENAI_API_KEY, pid: process.pid }));
http.createServer((req, res) => { res.writeHead(200); res.end('{"value":{"ready":true}}'); }).listen(config.server.port, config.server.address);
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${root}:${oldPath}`;
    process.env.OPENAI_API_KEY = 'fixture-secret-not-for-phone';
    const url = await server.start(new AbortController().signal);
    const observed = JSON.parse(await readFile(evidence, 'utf8')) as {
      secret?: string;
      config: { server: { address: string } };
    };
    assert.equal(observed.secret, undefined);
    assert.equal(observed.config.server.address, '127.0.0.1');
    assert.equal((await fetch(`${url}/status`)).status, 200);
    await server.stop();
    await assert.rejects(fetch(`${url}/status`));
    await assert.rejects(server.start(AbortSignal.abort()));
    await writeFile(
      path.join(root, 'appium'),
      `#!${process.execPath}\nsetInterval(() => {}, 1000);`,
      { mode: 0o700 },
    );
    await assert.rejects(server.start(AbortSignal.timeout(100)), /abort|timeout/i);
    await writeFile(path.join(root, 'appium'), `#!${process.execPath}\nprocess.exit(1);`, {
      mode: 0o700,
    });
    await assert.rejects(server.start(new AbortController().signal), /Could not start/);
  } finally {
    await server.stop();
    process.env.PATH = oldPath;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    await rm(root, { recursive: true, force: true });
  }
});
