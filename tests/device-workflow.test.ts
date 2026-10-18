import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { DeviceTestSchema } from '../packages/contracts/src/device-verification.js';
import { DeviceVerification } from '../packages/core/src/device-verification.js';
import type { AgentRuntime, RuntimeRequest } from '../packages/runtimes/src/index.js';
import { ManagedAppium } from '../packages/verification/src/managed-appium.js';
import { phoneFixture, target } from './device-fixture.js';

const config = DeviceTestSchema.parse({
  name: 'Fixture TestFlight app',
  target,
  buildLabel: '1.0 (42)',
  criteria: ['A note is visible'],
  runtime: { provider: 'codex', auth: 'subscription' },
  allowInteractions: true,
});

/** Drive real MCP tools with synthetic conclusions, never a live model or phone. */
class DeviceFixtureRuntime implements AgentRuntime {
  mode = 'pass';
  async run(r: RuntimeRequest) {
    assert.equal(r.config.auth, 'subscription');
    assert.equal(r.prompt.includes('repository evidence'), false);
    const review = r.prompt.includes('independent reviewer');
    const client = new Client({ name: 'device-fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(r.tools.url), {
        requestInit: { headers: { Authorization: `Bearer ${r.tools.token}` } },
      }) as Transport,
    );
    try {
      if (this.mode === 'throw') throw new Error('Fixture provider failure');
      if (!review) {
        const result = await client.callTool({
          name: 'phone_observe',
          arguments: { reason: 'Inspect fixture app' },
        });
        assert.equal(result.isError, undefined);
      } else if (this.mode !== 'unviewed') {
        await client.callTool({ name: 'view_phone_evidence', arguments: { id: 1 } });
      }
      return {
        version: 'device-fixture-only',
        value: {
          verdict:
            this.mode === 'unverified'
              ? 'unverified'
              : review && this.mode === 'disagree'
                ? 'fail'
                : 'pass',
          explanation: 'Synthetic screenshot evidence.',
          evidence: [this.mode === 'missing' ? 99 : 1],
        },
      };
    } finally {
      await client.close();
    }
  }
}

/** Wait for a bounded synthetic run to terminate and return its persisted outcome. */
async function completed(service: DeviceVerification, id: string) {
  for (let count = 0; count < 200; count++) {
    const run = await service.read(id);
    if (run?.status !== 'running') {
      assert.ok(run);
      return run;
    }
    await setTimeout(20);
  }
  throw new Error('Fixture run did not finish.');
}

void test('repository-free runs publish portable evidence, enforce one phone owner, and preserve auth selection', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-flow-'));
  const fixture = phoneFixture();
  const service = new DeviceVerification(root, new DeviceFixtureRuntime(), fixture.http);
  t.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(await service.list(), []);
  assert.equal((await service.probe(target)).deviceName, 'Fixture iPhone');
  const { runId } = await service.start(config);
  await assert.rejects(service.start(config), /already in use/);
  const run = await completed(service, runId);
  assert.equal(run.status, 'completed');
  assert.equal(run.criteria[0]?.verdict, 'pass');
  assert.equal(run.runtimeVersion, 'device-fixture-only');
  const report = await readFile(run.reportPath, 'utf8');
  assert.match(report, /not a live agent/);
  assert.match(report, /not independently attested/);
  assert.match(report, /criterion-1\/step-1.png/);
  assert.equal((await service.list()).length, 1);
  assert.equal(service.cancel(runId).cancelled, false);
  assert.equal(fixture.calls.filter((c) => c.method === 'DELETE').length, 2);
});

void test('missing, unviewed, disagreeing, unavailable, and errored evidence never verifies a criterion', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-verdict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new DeviceFixtureRuntime();
  const service = new DeviceVerification(root, runtime, phoneFixture().http);
  t.after(() => service.dispose());
  for (const mode of ['missing', 'unviewed', 'disagree', 'unverified', 'throw']) {
    runtime.mode = mode;
    const { runId } = await service.start(config);
    const run = await completed(service, runId);
    assert.equal(run.criteria[0]?.verdict, 'unverified', mode);
  }
});

void test('cancellation aborts the actor, cleans up the phone, and leaves a saved cancelled run', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-cancel-'));
  const fixture = phoneFixture();
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const runtime: AgentRuntime = {
    run: async (r) => {
      entered();
      await new Promise((_, reject) => {
        r.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
      throw new Error('unreachable');
    },
  };
  const service = new DeviceVerification(root, runtime, fixture.http);
  t.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const { runId } = await service.start(config);
  await ready;
  assert.equal(service.cancel(runId).cancelled, true);
  const run = await completed(service, runId);
  assert.equal(run.status, 'cancelled');
  assert.equal(fixture.calls.at(-1)?.method, 'DELETE');
});

void test('setup and teardown failures stay explicit, interrupted history never silently resumes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-error-'));
  const fixture = phoneFixture();
  const service = new DeviceVerification(root, new DeviceFixtureRuntime(), fixture.http);
  t.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  fixture.state.installed = false;
  await assert.rejects(service.probe(target), /Install this app/);
  const { runId } = await service.start(config);
  const failed = await completed(service, runId);
  assert.equal(failed.status, 'failed');
  fixture.state.installed = true;
  fixture.state.closeFails = true;
  const next = await service.start(config);
  assert.match((await completed(service, next.runId)).message, /could not be closed/);
  await writeFile(
    path.join(root, 'device-runs', runId, 'run.json'),
    JSON.stringify({ ...failed, status: 'running' }),
  );
  assert.match((await service.read(runId))!.message, /Interrupted/);
  assert.equal(await service.read('00000000-0000-0000-0000-000000000000'), null);
});

void test('saved device evidence cannot redirect report opening or escape run storage', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-path-'));
  const service = new DeviceVerification(root, new DeviceFixtureRuntime(), phoneFixture().http);
  t.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const { runId } = await service.start(config);
  const run = await completed(service, runId);
  const file = path.join(root, 'device-runs', runId, 'run.json');
  await writeFile(file, JSON.stringify({ ...run, reportPath: '/tmp/foreign.html' }));
  assert.equal((await service.read(runId))!.reportPath, run.reportPath);
  await writeFile(file, JSON.stringify({ ...run, status: 'running', ownerPid: process.ppid }));
  assert.equal((await service.read(runId))!.status, 'running');
  await writeFile(file, JSON.stringify({ ...run, status: 'running', ownerPid: 2147483647 }));
  assert.equal((await service.read(runId))!.status, 'failed');
  await assert.rejects(service.read('../../outside'));
  await writeFile(file, JSON.stringify({ ...run, id: '00000000-0000-0000-0000-000000000000' }));
  await assert.rejects(service.read(runId), /identity/);
});

void test('shutdown rejects late phone follow-ups from an assessment that just completed', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-device-shutdown-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = phoneFixture();
  const service = new DeviceVerification(root, new DeviceFixtureRuntime(), fixture.http);
  await service.dispose();
  await assert.rejects(service.start(config), /shutting down/);
  await assert.rejects(service.probe(target), /shutting down/);
  assert.equal(fixture.calls.length, 0);
});

void test('managed verification refreshes installed builds, applies shared signing and releases its owned server', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-managed-flow-'));
  const fixture = phoneFixture();
  let capabilities: Record<string, unknown> = {};
  const http: typeof fetch = async (url, init) => {
    if (typeof url === 'string' && url.endsWith('/session') && init?.method === 'POST') {
      assert.equal(typeof init.body, 'string');
      capabilities = (
        JSON.parse(init.body as string) as {
          capabilities: { alwaysMatch: Record<string, unknown> };
        }
      ).capabilities.alwaysMatch;
    }
    return fixture.http(url, init);
  };
  const service = new DeviceVerification(root, new DeviceFixtureRuntime(), http);
  const start = t.mock.method(ManagedAppium.prototype, 'start', () =>
    Promise.resolve(target.serverUrl),
  );
  const stop = t.mock.method(ManagedAppium.prototype, 'stop', () => Promise.resolve());
  const apps = t.mock.method(service.setup, 'apps', () =>
    Promise.resolve([
      { bundleId: target.bundleId, name: 'Fixture app', version: '2', build: '99' },
    ]),
  );
  t.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await service.setup.save({ teamId: 'ABCDE12345', runnerBundleId: 'com.example.Runner' });
  const managed = { ...target, connection: 'managed' as const };
  const probe = await service.probe(managed);
  assert.equal(probe.appBuild, '99');
  assert.equal(capabilities['appium:xcodeOrgId'], 'ABCDE12345');
  assert.equal(capabilities['appium:updatedWDABundleId'], 'com.example.Runner');
  const { runId } = await service.start({ ...config, target: managed });
  await service.wait(runId);
  const run = await service.read(runId);
  assert.equal(run?.status, 'completed');
  assert.equal(run?.device.appVersion, '2');
  assert.match(
    await readFile(run.reportPath, 'utf8'),
    /Installed version observed on phone: 2. Build: 99/,
  );
  assert.equal(start.mock.callCount(), 2);
  assert.equal(stop.mock.callCount(), 2);
  assert.equal(apps.mock.callCount(), 2);
  apps.mock.mockImplementation(() => Promise.resolve([]));
  await assert.rejects(service.probe(managed), /Install the selected app/);
  assert.equal(start.mock.callCount(), 2);
  // A missing app must release the device lock so the next attempt is possible.
  await service.probe(target);
});
