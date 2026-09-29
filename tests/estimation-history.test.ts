import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { EstimationSnapshot, RunManifest } from '../packages/contracts/src/index.js';
import { collectEstimationHistory } from '../packages/core/src/estimation-history.js';
import { atomic, hash, json } from '../packages/core/src/storage.js';
import { ConnectionManager } from '../packages/integrations/src/index.js';

async function historyFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-estimation-history-'));
  const integration = new ConnectionManager(root, { keyring: false });
  let properties: Record<string, unknown> = { limit: {}, cursor: {}, completedAfter: {} };
  let approved = true;
  let pages: unknown[] = [];
  let failed = false;
  let calls = 0;
  let previous: EstimationSnapshot | null = null;
  const args: Record<string, unknown>[] = [];
  integration.refreshTools = () =>
    Promise.resolve([
      {
        name: 'read_history',
        description: 'Synthetic history',
        inputSchema: { properties },
        readOnly: true,
        approved,
        reason: 'Synthetic test consent',
      },
    ]);
  integration.call = (connectionId, tool, input, signal) => {
    signal?.throwIfAborted();
    if (failed) return Promise.reject(new Error('Synthetic offline failure'));
    args.push(input);
    const payload = pages[calls++] ?? { issues: [], nextCursor: null };
    const result = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
    return Promise.resolve({
      result,
      receipt: {
        connectionId,
        tool,
        argumentsHash: hash(input),
        resultHash: hash(result),
        calledAt: new Date().toISOString(),
        recordCount: 1,
      },
    });
  };
  const run: RunManifest & { refreshHistory?: boolean } = {
    id: 'estimate',
    projectId: 'project',
    kind: 'estimate',
    status: 'running',
    stage: 'estimate',
    createdAt: new Date().toISOString(),
    project: {
      id: 'project',
      name: 'Synthetic project',
      context: 'Synthetic intent',
      repositories: [],
      runtime: { provider: 'codex', auth: 'subscription' },
      sources: {
        contextConnectionIds: [],
        history: {
          connectionId: 'connection',
          sourceId: 'team',
          sourceLabel: 'Synthetic team',
          historyTool: 'read_history',
          sourceArgument: 'teamId',
        },
      },
    },
  };
  const context = {
    integrations: integration,
    emit: () => {},
    getEstimate: () => Promise.resolve(previous),
  };
  return {
    root,
    run,
    context,
    args,
    calls: () => calls,
    pages(value: unknown[]) {
      pages = value;
    },
    properties(value: Record<string, unknown>) {
      properties = value;
    },
    approved(value: boolean) {
      approved = value;
    },
    failed(value: boolean) {
      failed = value;
    },
    previous(value: EstimationSnapshot) {
      previous = value;
    },
    read: (signal = new AbortController().signal) =>
      collectEstimationHistory(context, run, signal, root),
    close: async () => {
      await integration.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function issue(id: string, completedAt: string | null = new Date().toISOString()) {
  return {
    id,
    title: `Synthetic issue ${id}`,
    completedAt,
    startedAt: new Date(Date.now() - 86400000).toISOString(),
  };
}

void test('history collection preserves provenance, paginates approved tools, and resumes without refetching', async () => {
  const f = await historyFixture();
  try {
    f.pages([
      { issues: [issue('1'), issue('old', '2020-01-01T00:00:00Z')], nextCursor: 'second' },
      { issues: [issue('2'), issue('missing', null), issue('1')], nextCursor: null },
    ]);
    const result = await f.read();
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ['1', '2'],
    );
    assert.equal(result.historyComplete, true);
    assert.equal(result.historyTruncated, false);
    assert.equal(result.receipts.length, 2);
    assert.ok(result.historyCollectedAt);
    assert.equal(f.args[0]?.limit, 100);
    assert.equal(f.args[1]?.cursor, 'second');
    assert.equal(f.args[0]?.teamId, 'team');
    assert.match(String(f.args[0]?.completedAfter), /^\d{4}-/);
    assert.ok(
      result.historyLimitations.some((message) => message.includes('completion timestamp')),
    );
    assert.ok(result.historyLimitations.some((message) => message.includes('Duplicate')));
    assert.deepEqual(await f.read(), result);
    assert.equal(f.calls(), 2);
    const saved = await json<any>(path.join(f.root, 'history-source.json'));
    saved.reads[0].receipt.resultHash = '0'.repeat(64);
    await atomic(path.join(f.root, 'history-source.json'), saved);
    await assert.rejects(f.read(), /identity validation/);
    assert.equal(f.calls(), 2);
  } finally {
    await f.close();
  }
});

void test('history never calls unapproved tools and an explicit failed refresh preserves the previous estimate', async () => {
  const f = await historyFixture();
  try {
    f.approved(false);
    assert.match((await f.read()).historyLimitations.join(' '), /not approved/);
    assert.equal(f.calls(), 0);
    f.approved(true);
    f.failed(true);
    assert.match((await f.read()).historyLimitations.join(' '), /unavailable/);
    f.run.refreshHistory = true;
    f.previous({ id: 'previous' } as EstimationSnapshot);
    await assert.rejects(f.read(), /previous accepted estimate was preserved/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.read(controller.signal), /abort/i);
    f.run.project.sources = { contextConnectionIds: [], history: null };
    const absent = await f.read();
    assert.equal(absent.historyComplete, false);
    assert.equal(absent.historyCollectedAt, null);
    assert.deepEqual(absent.receipts, []);
    assert.match(absent.historyLimitations.join(' '), /Connect a ticket source/);
  } finally {
    await f.close();
  }
});

void test('repeated, unadvanceable, and excessive pages stop with explicit incompleteness', async () => {
  for (const mode of ['repeated', 'unadvanceable', 'records', 'calls', 'unknown-completeness']) {
    const f = await historyFixture();
    try {
      if (mode === 'repeated')
        f.pages([
          { issues: [issue('1')], nextCursor: 'repeat' },
          { issues: [issue('2')], nextCursor: 'repeat' },
        ]);
      if (mode === 'unadvanceable') {
        f.properties({});
        f.pages([{ issues: [issue('1')], nextCursor: 'next' }]);
      }
      if (mode === 'records')
        f.pages([
          {
            issues: Array.from({ length: 501 }, (_, index) => issue(String(index))),
            nextCursor: null,
          },
        ]);
      if (mode === 'calls')
        f.pages(
          Array.from({ length: 101 }, (_, index) => ({ issues: [], nextCursor: String(index) })),
        );
      if (mode === 'unknown-completeness') {
        f.properties({});
        f.pages([{ issues: [issue('1')] }]);
      }
      const result = await f.read();
      assert.equal(result.historyComplete, false);
      assert.equal(result.historyTruncated, mode !== 'unknown-completeness');
      assert.ok(result.historyLimitations.length);
      assert.ok(result.rows.length <= 500);
      assert.ok(f.calls() <= 100);
      if (mode === 'repeated') assert.equal(f.calls(), 2);
      if (mode === 'unadvanceable') assert.equal(f.calls(), 1);
    } finally {
      await f.close();
    }
  }
});

void test('source checkpoint corruption fails before a new tool call while changed selection collects new evidence', async () => {
  const f = await historyFixture();
  try {
    f.pages([{ issues: [issue('1')], nextCursor: null }]);
    await f.read();
    f.run.project.sources!.history!.sourceId = 'another-team';
    await f.read();
    assert.equal(f.calls(), 2);
    assert.equal(f.args[1]?.teamId, 'another-team');
    await atomic(path.join(f.root, 'history-source.json'), { records: 'corrupt' });
    await assert.rejects(f.read());
    assert.equal(f.calls(), 2);
  } finally {
    await f.close();
  }
});
