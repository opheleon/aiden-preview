import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { ActiveWork } from '../apps/desktop/src/active-work.js';
import type { RunEvent } from '../packages/contracts/src/index.js';
import { accountMethods } from '../packages/core/src/accounts/methods.js';
import type { WorkerClient } from '../packages/core/src/client.js';
import { Engine } from '../packages/core/src/engine.js';
import { followWithBrowserCheck, startLook } from '../packages/core/src/look.js';
import { Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

/** Poll until a condition holds, failing after a few seconds instead of hanging. */
async function until(check: () => Promise<boolean> | boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * An engine with approved requirements, the worker's account methods over it, and Electron
 * main's busy mirror wired the way main.ts wires it: every worker event, and the worker's note
 * that a run has fully finished, refreshes the mirror.
 */
async function setup() {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const events: RunEvent[] = [];
  // Created after the worker it reads; events before then have no mirror to refresh.
  const holder: { mirror?: ActiveWork } = {};
  const engine = new Engine(new Store(path.join(f.root, 'data')), runtime, (event) => {
    events.push(event);
    void holder.mirror?.refresh();
  });
  engine.onWorkChanged = () => void holder.mirror?.refresh();
  // Nothing answers on localhost, so the browser check has to ask where the app runs.
  engine.discover = { fetch: () => Promise.reject(new Error('connection refused')) };
  const methods = accountMethods(engine, {
    diagnostics: () => Promise.reject(new Error('not used')),
  });
  const worker = {
    request: (method: 'activeWork' | 'accountPoll', params?: unknown) => methods[method](params),
  } as unknown as Pick<WorkerClient, 'request'>;
  const mirror = new ActiveWork(worker);
  holder.mirror = mirror;
  const prepared = await engine.prepare(f.project);
  await engine.wait(prepared.runId);
  // The written requirements carry a delivery plan, so a finished check goes on to sizing.
  const product = await engine.candidate(f.project.id, prepared.runId);
  await engine.approve(f.project.id, prepared.runId, product);
  const busy = async () => ((await methods.activeWork({})) as { busy: boolean }).busy;
  /** Wait for every chained run to finish; gaps between runs are not idle. */
  const settled = (count: number, what: string) =>
    until(async () => {
      const runs = await engine.history(f.project.id);
      return runs.length >= count && !engine.hasActiveWork();
    }, what);
  return {
    f,
    engine,
    events,
    mirror,
    methods,
    busy,
    settled,
    close: async () => {
      mirror.stop();
      await engine.dispose();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}

/** Whether a log line for the run arrived after the event that finished it. */
function lateActivity(events: RunEvent[], runId: string): boolean {
  const finished = events.findIndex((e) => e.runId === runId && e.type === 'completed');
  return (
    finished >= 0 &&
    events.slice(finished + 1).some((e) => e.runId === runId && e.type === 'activity')
  );
}

void test('a code check that completes, then gets a late log line, leaves this machine not busy', async () => {
  const s = await setup();
  try {
    const started = await s.engine.report(s.f.project.id);
    assert.equal(await s.busy(), true, 'the check is running');
    await s.mirror.refresh();
    assert.equal(s.mirror.isBusy(), true);
    followWithBrowserCheck(s.engine, s.f.project.id, started.runId);
    await until(() => lateActivity(s.events, started.runId), 'the browser check question');
    await s.settled(2, 'the check and its follow-up');
    // The follow-up asked where the app runs and logged it on the finished check. Counting run
    // events, that line marked the check active again with nothing left to finish it.
    const history = await s.engine.history(s.f.project.id);
    assert.equal(history.find((r) => r.id === started.runId)?.status, 'completed');
    assert.equal(await s.busy(), false);
    await s.mirror.refresh();
    assert.equal(s.mirror.isBusy(), false, 'Electron main sees the worker idle');
    // The Teams poll reports the worker's own state; a stale host flag is ignored.
    await s.methods.accountPoll({ idleSeconds: 600, onBattery: false, busy: true });
    await s.methods.accountPoll({ idleSeconds: 600, onBattery: false });
  } finally {
    await s.close();
  }
});

void test('a check whose surface follow-up only logs, with no terminal event, ends idle', async () => {
  const s = await setup();
  try {
    // Asking for surface checks with none configured adds a result line to the finished check;
    // the chain then sizes the remaining work.
    const started = await startLook(s.engine, s.f.project.id, 'you', undefined, true);
    await s.settled(3, 'the check and remaining-work sizing');
    assert.ok(lateActivity(s.events, started.runId), 'the result line came after completion');
    const sizing = (await s.engine.history(s.f.project.id)).find((r) => r.kind === 'estimate');
    assert.equal(sizing?.status, 'completed');
    assert.equal(await s.busy(), false);
    await s.mirror.refresh();
    assert.equal(s.mirror.isBusy(), false);
  } finally {
    await s.close();
  }
});

void test('the busy mirror goes idle on its own once a finished run leaves the worker', async () => {
  const s = await setup();
  try {
    // No manual refresh and no timer: only worker events and the finished-run note move it.
    const started = await s.engine.report(s.f.project.id);
    await until(() => s.mirror.isBusy(), 'the mirror to see the check running');
    await s.engine.wait(started.runId);
    await s.settled(1, 'the check');
    // The completed event arrives while the run still holds its lock, so a read on that event
    // alone says busy; a restart to update would then be refused until the next timer read.
    await until(() => !s.mirror.isBusy(), 'the mirror to see the worker idle');
  } finally {
    await s.close();
  }
});

void test('the busy mirror coalesces reads, keeps its last answer through a failed read, and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const answers: (boolean | Error)[] = [true, false, new Error('worker restarting')];
  let reads = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const worker = {
    request: async () => {
      reads++;
      if (reads === 1) await gate;
      const answer = answers.shift() ?? false;
      if (answer instanceof Error) throw answer;
      return { busy: answer };
    },
  } as unknown as Pick<WorkerClient, 'request'>;
  const mirror = new ActiveWork(worker, 1000);
  assert.equal(mirror.isBusy(), false, 'idle until the worker answers');
  mirror.start();
  const second = mirror.refresh();
  const third = mirror.refresh();
  assert.equal(reads, 1, 'refreshes during a read share it');
  release();
  await Promise.all([second, third]);
  assert.equal(reads, 2, 'one more read after the shared one');
  assert.equal(mirror.isBusy(), false, 'the newest answer wins');
  t.mock.timers.tick(1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 3, 'the timer reads again');
  assert.equal(mirror.isBusy(), false, 'a failed read keeps the last answer');
  mirror.stop();
  t.mock.timers.tick(5000);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 3, 'no reads after stop');
});
