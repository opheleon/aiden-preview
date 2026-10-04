import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import {
  appendActivity,
  readActivity,
  readRunLog,
  recordStep,
} from '../packages/core/src/activity.js';
import { appendLine, atomic, Store } from '../packages/core/src/storage.js';
import { redactor } from '../packages/verification/src/index.js';

const projectId = 'activity-project';

/** Save a run manifest so the timeline can find it. */
async function saveRun(store: Store, run: Partial<RunManifest> & { id: string }): Promise<void> {
  await atomic(path.join(store.run(projectId, run.id), 'manifest.json'), {
    projectId,
    kind: 'report',
    status: 'completed',
    stage: 'complete',
    project: { id: projectId },
    createdAt: '2026-09-29T08:00:00.000Z',
    ...run,
  });
}

/** Run a test against a throwaway store. */
async function withStore(fn: (store: Store, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-activity-'));
  try {
    await fn(new Store(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('log lines are redacted, clipped, free of em dashes, saved, and streamed', () =>
  withStore(async (store) => {
    const events: RunEvent[] = [];
    const context = { store, emit: (event: RunEvent) => events.push(event) };
    const entry = await appendActivity(
      context,
      { id: 'run-1', projectId },
      {
        kind: 'check',
        requirementId: 'REQ-1',
        summary: 'Signed in as hunter2 \u2014 then checked   the list',
        reason: `${'x'.repeat(700)}`,
        evidence: 'REQ-1',
      },
      redactor(['hunter2']),
    );
    assert.doesNotMatch(entry.summary, /hunter2/);
    assert.match(entry.summary, /\[test credential\]/);
    assert.doesNotMatch(entry.summary, /\u2014/);
    assert.doesNotMatch(entry.summary, / {2}/);
    assert.equal(entry.reason?.length, 600);
    assert.ok(entry.reason?.endsWith('...'));
    assert.equal(events[0]?.type, 'activity');
    assert.deepEqual(events[0]?.activity, entry);
    await saveRun(store, { id: 'run-1' });
    assert.deepEqual(await readActivity(store, projectId), [entry]);
  }));

void test('the timeline is newest first, skips torn and foreign lines, and rebuilds old runs', () =>
  withStore(async (store) => {
    await saveRun(store, { id: 'old-ok', createdAt: '2026-09-01T08:00:00.000Z' });
    await saveRun(store, {
      id: 'old-failed',
      kind: 'verify',
      status: 'failed',
      error: 'Browser could not start.',
      createdAt: '2026-09-02T08:00:00.000Z',
    });
    await saveRun(store, { id: 'old-running', kind: 'prepare', status: 'running' });
    await saveRun(store, { id: 'new', createdAt: '2026-09-29T09:00:00.000Z' });
    const dir = store.run(projectId, 'new');
    const line = (at: string, summary: string, runId = 'new') => ({
      at,
      runId,
      kind: 'look',
      summary,
    });
    await appendLine(dir, 'activity.jsonl', line('2026-09-29T09:00:00.000Z', 'First'));
    await appendFile(path.join(dir, 'activity.jsonl'), '{"torn":');
    await appendLine(dir, 'activity.jsonl', line('2026-09-29T09:01:00.000Z', 'Second'));
    await appendLine(dir, 'activity.jsonl', line('2026-09-29T09:02:00.000Z', 'Moved', 'other'));
    const entries = await readActivity(store, projectId);
    assert.deepEqual(
      entries.filter((e) => e.runId === 'new').map((e) => e.summary),
      ['Second', 'First'],
    );
    const rebuilt = entries.filter((e) => e.reconstructed);
    assert.ok(rebuilt.some((e) => e.runId === 'old-failed' && /Stopped: Browser/.test(e.summary)));
    assert.ok(rebuilt.some((e) => e.runId === 'old-ok' && e.summary === 'Finished.'));
    assert.equal(
      rebuilt.filter((e) => e.runId === 'old-running').length,
      1,
      'a run still in progress has no outcome line yet',
    );
    assert.deepEqual(
      entries.map((e) => e.at),
      [...entries.map((e) => e.at)].sort().reverse(),
    );
  }));

void test('the log refuses to follow a symlink out of the run folder', () =>
  withStore(async (store, root) => {
    const dir = store.run(projectId, 'run-1');
    await mkdir(dir, { recursive: true });
    const outside = path.join(root, 'outside.jsonl');
    await writeFile(outside, '');
    await symlink(outside, path.join(dir, 'activity.jsonl'));
    await assert.rejects(
      appendActivity(
        { store, emit: () => {} },
        { id: 'run-1', projectId },
        {
          kind: 'look',
          summary: 'Looking',
        },
      ),
    );
  }));

void test('steps fill a run full history, stay out of the brief, and stop being saved at the cap', () =>
  withStore(async (store) => {
    await saveRun(store, { id: 'run-1' });
    const events: RunEvent[] = [];
    const context = { store, emit: (event: RunEvent) => events.push(event) };
    await appendActivity(context, { id: 'run-1', projectId }, { kind: 'look', summary: 'Looking' });
    for (let i = 0; i < 2001; i++)
      await recordStep(context, { id: 'run-1', projectId }, `Read file ${i}`);
    const log = await readRunLog(store, projectId, 'run-1');
    assert.equal(log.length, 2001, 'one look line and the first 2000 steps');
    assert.equal(log.at(-1)?.summary, 'Read file 1999');
    assert.deepEqual(
      (await readActivity(store, projectId)).map((e) => e.summary),
      ['Looking'],
    );
    assert.equal(events.filter((e) => e.activity?.kind === 'step').length, 2000);
    await assert.rejects(readRunLog(store, projectId, 'missing'), /no longer exists/);
    await saveRun(store, { id: 'old', status: 'failed', error: 'Gone' });
    assert.match((await readRunLog(store, projectId, 'old')).at(-1)!.summary, /Stopped: Gone/);
  }));
