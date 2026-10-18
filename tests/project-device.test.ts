import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { ProjectDeviceTestSchema } from '../packages/contracts/src/device-verification.js';
import { readActivity } from '../packages/core/src/activity.js';
import { recordCall } from '../packages/core/src/calls.js';
import { DeviceVerification } from '../packages/core/src/device-verification.js';
import { Engine } from '../packages/core/src/engine.js';
import { startLook } from '../packages/core/src/look.js';
import { verifyProjectDevice } from '../packages/core/src/project-device.js';
import { lifecycleView } from '../packages/core/src/project-lifecycle.js';
import { verifyConfiguredSurfaces } from '../packages/core/src/project-verification.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import {
  readAppUrl,
  saveVerificationSettings,
} from '../packages/core/src/verification-settings.js';
import { phoneFixture, target } from './device-fixture.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const config = ProjectDeviceTestSchema.parse({
  target,
  buildLabel: 'Fixture 42',
  allowInteractions: true,
});

/** Exercise real repository assessment and device orchestration using explicitly synthetic providers. */
async function setup(
  verification?: import('../packages/contracts/src/verification.js').VerificationUpdate,
) {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  runtime.understanding = {
    ...f.product,
    calls: [],
    requirements: [
      {
        ...f.product.requirements[0],
        edgeCases: [{ id: 'E1', text: 'An empty library is explained.' }],
      },
      { ...f.product.requirements[1], edgeCases: [] },
    ],
  };
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, runtime);
  const phone = phoneFixture();
  const mobile = {
    run: () =>
      Promise.resolve({
        version: 'device-project-fixture',
        value: {
          verdict: 'unverified',
          explanation: 'Synthetic provider has no visual evidence.',
          evidence: [],
        },
      }),
  };
  const devices = new DeviceVerification(store.root, mobile, phone.http);
  Object.defineProperty(engine, 'devices', { value: devices });
  const prepared = await engine.prepare(f.project, {
    autoAccept: true,
    ...(verification ? { verification } : {}),
  });
  await engine.wait(prepared.runId);
  assert.ok(
    (await engine.state(f.project.id)).baseline,
    JSON.stringify(await engine.history(f.project.id)),
  );
  return { f, runtime, engine, devices, store, phone };
}

/** Wait for a bounded fixture workflow, including gaps between chained stages. */
async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await setTimeout(25);
  }
  throw new Error('Project phone workflow did not settle.');
}

void test('code assessment precedes phone checks and both retain shared requirement and snapshot identity', async (t) => {
  const { f, engine, devices, store } = await setup();
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  const before = await lifecycleView(store, f.project);
  const started = await startLook(engine, f.project.id, 'you', config);
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) => r.kind === 'estimate' && r.status === 'completed',
    ),
  );
  const report = await engine.getReport(f.project.id, started.runId);
  const run = (await devices.list())[0]!;
  assert.equal(run.status, 'completed');
  assert.equal(run.source?.reportId, report.id);
  assert.equal(run.source?.baselineId, report.baselineId);
  assert.equal(run.source?.projectId, f.project.id);
  assert.deepEqual(
    run.source?.snapshots,
    report.snapshots.map(({ repositoryId, sha }) => ({ repositoryId, sha })),
  );
  assert.deepEqual(
    run.source?.checks.map((c) => [c.requirementId, c.edgeCaseId]),
    [
      ['REQ-1', null],
      ['REQ-1', 'E1'],
      ['REQ-2', null],
    ],
  );
  assert.equal(run.criteria.length, 3);
  assert.ok(run.criteria.every((c) => c.verdict === 'unverified'));
  assert.deepEqual(run.runtime, f.project.runtime);
  assert.match(await readFile(run.reportPath, 'utf8'), /Code assessment provenance/);
  assert.match(
    await readFile(run.reportPath, 'utf8'),
    /correspondence to these assessed commits is unverified/,
  );
  const pointer = await json<{ runId: string }>(
    path.join(store.project(f.project.id), 'latest-device-verification.json'),
  );
  assert.equal(pointer.runId, run.id);
  assert.notEqual((await lifecycleView(store, f.project)).evidenceKey, before.evidenceKey);
  assert.ok(
    (await readActivity(store, f.project.id)).some(
      (a) => a.requirementId === 'REQ-1' && a.summary.includes('Installed app: unverified'),
    ),
  );
  assert.deepEqual(
    (await engine.getReport(f.project.id, started.runId)).assessments,
    report.assessments,
  );
});

void test('an unavailable phone preserves the accepted code assessment and automatic estimates', async (t) => {
  const { f, engine, devices } = await setup();
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  t.mock.method(devices, 'start', () => {
    throw new Error('No paired phone');
  });
  const started = await startLook(engine, f.project.id, 'you', config);
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) => r.kind === 'estimate' && r.status === 'completed',
    ),
  );
  assert.ok((await engine.getReport(f.project.id, started.runId)).assessments.length);
  assert.ok(
    (await readActivity(engine.store, f.project.id)).some(
      (a) => a.summary === 'Phone verification could not finish. Code assessment is preserved.',
    ),
  );
});

void test('failed code assessments and superseded baselines cannot launch phone verification', async (t) => {
  const { f, engine, runtime, phone } = await setup();
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  runtime.invalid = true;
  const started = await startLook(engine, f.project.id, 'you', config);
  await engine.wait(started.runId);
  assert.equal(
    (await engine.history(f.project.id)).find((r) => r.id === started.runId)?.status,
    'failed',
  );
  assert.equal(phone.calls.length, 0);
  runtime.invalid = false;
  const accepted = await engine.report(f.project.id);
  await engine.wait(accepted.runId);
  const run = (await engine.history(f.project.id)).find((r) => r.id === accepted.runId)!;
  await engine.editProduct(f.project.id, { ...f.product, overview: 'A changed scope' });
  await verifyProjectDevice(engine, run, config);
  assert.equal(phone.calls.length, 0);
});

void test('blocking decisions defer phone checks without losing the completed code report', async (t) => {
  const { f, engine, phone } = await setup();
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  const accepted = await engine.report(f.project.id);
  await engine.wait(accepted.runId);
  const run = (await engine.history(f.project.id)).find((r) => r.id === accepted.runId)!;
  for (const requirement of f.product.requirements) {
    await recordCall(
      engine.store,
      f.project.id,
      {
        requirementId: requirement.id,
        edgeCaseId: null,
        question: `Which behavior should ${requirement.id} have?`,
        options: ['A', 'B'],
        assumption: 'Wait for an answer.',
        owner: 'you',
        blocking: true,
      },
      'decision',
      run.id,
    );
  }
  await verifyProjectDevice(engine, run, config);
  assert.equal(phone.calls.length, 0);
  assert.ok(
    (await readActivity(engine.store, f.project.id)).some(
      (a) => a.summary === 'No unblocked requirements to check on the phone.',
    ),
  );
  assert.equal((await engine.getReport(f.project.id, run.id)).id, run.id);
});

void test('setup saves a project configuration and automatic checks use it without repeated input', async (t) => {
  const { f, engine, devices, store } = await setup({ trigger: 'after_assessment', phone: config });
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  assert.equal((await readAppUrl(engine, f.project.id)).phone?.target.udid, config.target.udid);
  assert.deepEqual(await readAppUrl(engine, 'another-project'), { url: null });
  await startLook(engine, f.project.id, 'morning');
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) => r.kind === 'estimate' && r.status === 'completed',
    ),
  );
  assert.equal((await devices.list()).length, 1);
  await saveVerificationSettings(engine, f.project.id, { trigger: 'manual' });
  const next = await startLook(engine, f.project.id, 'you');
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) =>
        'estimateReportId' in r && r.estimateReportId === next.runId && r.status === 'completed',
    ),
  );
  assert.equal((await devices.list()).length, 1, 'manual mode does not touch the phone');
  const forced = await startLook(engine, f.project.id, 'you', undefined, true);
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) =>
        'estimateReportId' in r && r.estimateReportId === forced.runId && r.status === 'completed',
    ),
  );
  assert.equal((await devices.list()).length, 2);
  const reloaded = await readAppUrl({ store: new Store(store.root) }, f.project.id);
  assert.equal(reloaded.trigger, 'manual');
  assert.deepEqual(reloaded.phone, config);
});

void test('browser/API configuration is dispatched after assessment and preserves private settings on edits', async (t) => {
  const { f, engine, store } = await setup({
    trigger: 'after_assessment',
    url: 'http://localhost:3000',
    api: { url: 'http://localhost:8000' },
  });
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  const started: string[] = [];
  t.mock.method(engine, 'verify', (id: string) => {
    started.push(id);
    return Promise.resolve({ runId: 'synthetic-browser-run' });
  });
  const next = await startLook(engine, f.project.id, 'you');
  await until(async () =>
    (await engine.history(f.project.id)).some(
      (r) =>
        'estimateReportId' in r && r.estimateReportId === next.runId && r.status === 'completed',
    ),
  );
  assert.deepEqual(started, [f.project.id]);
  const file = path.join(store.project(f.project.id), 'verification.json');
  const previous = await json<Record<string, unknown>>(file);
  await atomic(file, {
    ...previous,
    credentials: { username: 'fixture-user', password: 'fixture-secret' },
  });
  await saveVerificationSettings(engine, f.project.id, {
    phone: config,
    url: null,
    trigger: 'manual',
  });
  const publicSettings = await readAppUrl(engine, f.project.id);
  assert.equal(JSON.stringify(publicSettings).includes('fixture-secret'), false);
  assert.equal(publicSettings.url, null);
  assert.equal(publicSettings.api?.url, 'http://localhost:8000/');
  assert.equal(
    (await json<Record<string, unknown>>(file)).credentials,
    undefined,
    'removing the browser clears its legacy credentials',
  );
  await assert.rejects(
    saveVerificationSettings(engine, f.project.id, {
      phone: { ...config, allowInteractions: false },
    } as never),
  );
});

void test('cancelling browser verification prevents the configured phone follow-up', async (t) => {
  const { f, engine, phone } = await setup({
    trigger: 'after_assessment',
    url: 'http://localhost:3000',
    phone: config,
  });
  t.after(async () => {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  });
  const accepted = await engine.report(f.project.id);
  await engine.wait(accepted.runId);
  const state = await engine.state(f.project.id);
  const reportRun = state.runs.find((r) => r.id === accepted.runId)!;
  t.mock.method(engine, 'verify', () => Promise.resolve({ runId: 'cancelled-browser' }));
  t.mock.method(engine, 'state', () =>
    Promise.resolve({
      ...state,
      runs: [
        ...state.runs,
        { ...reportRun, id: 'cancelled-browser', kind: 'verify', status: 'cancelled' },
      ],
    }),
  );
  await verifyConfiguredSurfaces(engine, reportRun, false);
  assert.equal(phone.calls.length, 0);
});
