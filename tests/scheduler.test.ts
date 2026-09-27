import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultSchedule } from '../apps/desktop/src/scheduler.js';
import {
  LocalScheduler,
  nextOccurrence,
  ScheduleConfigSchema,
} from '../apps/desktop/src/scheduler.js';
import { required } from './required.js';
const config = {
  enabled: true,
  frequency: 'daily' as const,
  time: '09:00',
  weekday: 1,
  includeEstimates: false,
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-schedules-'));
  let now = new Date(2026, 8, 23, 8, 59, 50);
  let busy = false;
  let baseline: any = { reviewedAt: '2026-09-01T00:00:00.000Z' };
  let runs: any[] = [];
  const calls: string[] = [];
  const scheduler = new LocalScheduler({
    dataRoot: root,
    now: () => now,
    isBusy: () => busy,
    worker: {
      request: ((method: string) => {
        calls.push(method);
        if (method === 'state')
          return Promise.resolve({ project: { id: 'project' }, baseline, runs });
        return Promise.resolve(
          method === 'cancel' ? { cancelled: true } : { runId: method + '-run' },
        );
      }) as any,
    },
  });
  await scheduler.start(false);
  return {
    scheduler,
    root,
    calls,
    setTime: (date: Date) => {
      now = date;
    },
    setBusy: (value: boolean) => {
      busy = value;
    },
    pending: () => {
      runs = [{ kind: 'prepare', status: 'review', createdAt: '2026-09-22T00:00:00.000Z' }];
    },
    noBaseline: () => {
      baseline = null;
    },
  };
}
void test('calendar scheduling handles daily, weekly, disabled and DST without duplicate fall runs', () => {
  const prior = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(
      nextOccurrence(config, new Date('2026-09-23T09:00:00-07:00')),
      '2026-09-24T16:00:00.000Z',
    );
    assert.equal(
      nextOccurrence({ ...config, frequency: 'weekly' }, new Date('2026-09-23T09:00:00-07:00')),
      '2026-09-28T16:00:00.000Z',
    );
    assert.equal(
      nextOccurrence({ ...config, time: '02:30' }, new Date('2026-03-08T00:00:00-08:00')),
      '2026-03-08T10:30:00.000Z',
    );
    assert.equal(
      nextOccurrence({ ...config, time: '01:30' }, new Date('2026-11-01T01:31:00-07:00')),
      '2026-11-02T09:30:00.000Z',
    );
    assert.equal(nextOccurrence({ ...config, enabled: false }, new Date()), null);
    assert.equal(ScheduleConfigSchema.safeParse({ ...config, time: '24:00' }).success, false);
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});
void test('a due slot is persisted before launch, runs once, chains estimates, and records completion', async () => {
  const f = await fixture();
  await f.scheduler.set('project', { ...config, includeEstimates: true });
  f.setTime(new Date(2026, 8, 23, 9, 0, 0));
  await Promise.all([f.scheduler.tick(), f.scheduler.tick()]);
  assert.equal(f.calls.filter((x) => x === 'report').length, 1);
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'running');
  assert.equal(
    required(
      JSON.parse(await readFile(path.join(f.root, 'preferences/schedules.json'), 'utf8'))
        .schedules[0],
    ).lastRunId,
    'report-run',
  );
  f.scheduler.observe({
    type: 'completed',
    projectId: 'project',
    runId: 'report-run',
    report: { id: 'report-run' } as any,
  });
  await f.scheduler.tick();
  assert.equal(f.calls.filter((x) => x === 'estimate').length, 1);
  f.scheduler.observe({ type: 'completed', projectId: 'project', runId: 'estimate-run' });
  await f.scheduler.tick();
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'completed');
  f.scheduler.stop();
});
void test('busy operations and sleep skip missed slots; closing prevents launches', async () => {
  const f = await fixture();
  await f.scheduler.set('project', config);
  f.setBusy(true);
  f.setTime(new Date(2026, 8, 23, 9, 0, 0));
  await f.scheduler.tick();
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'skipped');
  f.setBusy(false);
  f.setTime(new Date(2026, 8, 24, 10, 0, 0));
  await f.scheduler.tick();
  assert.match(required(f.scheduler.list()[0]).message!, /asleep/);
  assert.equal(f.calls.includes('report'), false);
  f.scheduler.stop();
  f.setTime(new Date(2026, 8, 25, 9, 0, 0));
  await f.scheduler.tick();
  assert.equal(f.calls.includes('report'), false);
});
void test('unreviewed intent cannot be scheduled; new pending review blocks existing schedules', async () => {
  const f = await fixture();
  await f.scheduler.set('project', config);
  f.pending();
  await assert.rejects(f.scheduler.set('project', config), /pending requirements/);
  f.setTime(new Date(2026, 8, 23, 9, 0, 0));
  await f.scheduler.tick();
  assert.equal(f.calls.includes('report'), false);
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'failed');
  f.noBaseline();
  await assert.rejects(f.scheduler.set('project', config), /approve/);
  await f.scheduler.set('project', { ...config, enabled: false });
  f.scheduler.stop();
});
void test('clarification cancels unattended work; unrelated project events cannot finish it', async () => {
  const f = await fixture();
  await f.scheduler.set('project', config);
  f.setTime(new Date(2026, 8, 23, 9, 0, 0));
  await f.scheduler.tick();
  f.scheduler.observe({ type: 'completed', projectId: 'other', runId: 'other' });
  await f.scheduler.tick();
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'running');
  f.scheduler.observe({ type: 'clarification', projectId: 'project', runId: 'report-run' });
  await f.scheduler.tick();
  assert.ok(f.calls.includes('cancel'));
  f.scheduler.observe({ type: 'cancelled', projectId: 'project', runId: 'report-run' });
  await f.scheduler.tick();
  assert.equal(required(f.scheduler.list()[0]).lastStatus, 'skipped');
  assert.match(required(f.scheduler.list()[0]).message!, /clarification/);
  f.scheduler.stop();
});
void test('restart retains settings but skips expired slots and marks interrupted work', async () => {
  const f = await fixture();
  await f.scheduler.set('project', config);
  f.setTime(new Date(2026, 8, 23, 9, 0, 0));
  await f.scheduler.tick();
  f.scheduler.stop();
  const reopened = new LocalScheduler({
    dataRoot: f.root,
    worker: {
      request: () => Promise.reject(new Error('Must not launch')),
    },
    isBusy: () => false,
    now: () => new Date(2026, 8, 25, 10, 0, 0),
  });
  await reopened.start(false);
  await reopened.tick();
  assert.equal(required(reopened.list()[0]).lastStatus, 'interrupted');
  assert.equal(new Date(required(reopened.list()[0]).nextRunAt!).getDate(), 26);
  reopened.stop();
});

void test('scheduler chains a real fixture-engine assessment into estimates after releasing its project lock', async () => {
  const { fixture: repositoryFixture } = await import('./helpers.js');
  const { FixtureRuntime } = await import('./fixture-runtime.js');
  const { Engine } = await import('../packages/core/src/engine.js');
  const { Store } = await import('../packages/core/src/storage.js');
  const f = await repositoryFixture();
  const store = new Store(path.join(f.root, 'scheduled-engine'));
  let scheduler: LocalScheduler | undefined;
  const engine = new Engine(store, new FixtureRuntime(f), (event) => scheduler?.observe(event));
  let now = new Date(2026, 8, 23, 8, 59, 50);
  try {
    const prep = await engine.prepare(f.project);
    await engine.wait(prep.runId);
    await engine.approve(f.project.id, prep.runId, f.product);
    scheduler = new LocalScheduler({
      dataRoot: store.root,
      now: () => now,
      isBusy: () => false,
      worker: {
        request: (async (method: string, p: any) => {
          if (method === 'state') return engine.state(p.projectId);
          if (method === 'report') return engine.report(p.projectId);
          if (method === 'estimate') return engine.estimate(p.projectId, p.reportId);
          if (method === 'waitForRun') {
            await engine.wait(p.runId);
            return null;
          }
          if (method === 'cancel') return engine.cancel(p.runId);
          throw new Error('Unexpected call');
        }) as any,
      },
    });
    await scheduler.start(false);
    await scheduler.set(f.project.id, { ...config, includeEstimates: true });
    now = new Date(2026, 8, 23, 9, 0, 0);
    await scheduler.tick();
    const deadline = Date.now() + 15000;
    while (required(scheduler.list()[0]).lastStatus === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      await scheduler.tick();
    }
    assert.equal(required(scheduler.list()[0]).lastStatus, 'completed');
    const history = await engine.history(f.project.id);
    assert.ok(history.some((run) => run.kind === 'report' && run.status === 'completed'));
    assert.ok(history.some((run) => run.kind === 'estimate' && run.status === 'completed'));
  } finally {
    scheduler?.stop();
    await engine.dispose();
  }
});

void test('default schedules never start paid work without opt-in', () => {
  assert.equal(defaultSchedule.enabled, false);
  assert.equal(nextOccurrence(defaultSchedule, new Date()), null);
});
