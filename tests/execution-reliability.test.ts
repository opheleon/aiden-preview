import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { AccountTask } from '../packages/contracts/src/accounts-api.js';
import type { Project } from '../packages/contracts/src/index.js';
import { type AccountsClient, AccountsError } from '../packages/core/src/accounts/client.js';
import {
  publicationRecoveryServices,
  recoverPublication,
} from '../packages/core/src/accounts/publication-recovery.js';
import {
  type CompletionReceipt,
  flushReceipts,
  saveReceipt,
  sendReceipt,
} from '../packages/core/src/accounts/receipts.js';
import type { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { codingActivity } from '../packages/runtimes/src/coding-activity.js';
import { ExecutionWatchdog } from '../packages/runtimes/src/execution-watchdog.js';
import {
  MissingPublicationCommit,
  type PublicationInput,
} from '../packages/tools/src/delivery-git.js';

const limits = { idleMs: 10_000, toolMs: 30_000, absoluteMs: 60_000 };

void test('a live desktop cannot extend an idle coding process or its absolute budget', () => {
  const watch = new ExecutionWatchdog(limits, 0, 300_000);
  watch.renew(600_000);
  assert.match(watch.reason(10_000)!, /stopped producing/);
  for (let at = 5000; at < 60_000; at += 5000) {
    watch.observe({ type: 'output' }, at);
    assert.equal(watch.reason(at), null);
  }
  assert.match(watch.reason(60_000)!, /runtime limit/);
});

void test('quiet long tools have their own fixed budget, and status tools cannot reset idle time', () => {
  const watch = new ExecutionWatchdog(limits, 0, 300_000);
  watch.observe({ type: 'tool-start', id: 'tests' }, 1000);
  assert.equal(watch.reason(20_000), null);
  watch.observe({ type: 'tool-start', id: 'tests' }, 25_000);
  assert.match(watch.reason(31_000)!, /tool exceeded/);
  watch.observe({ type: 'tool-end', id: 'tests' }, 32_000);
  assert.equal(watch.reason(40_000), null);
  watch.observe({ type: 'tool-end', id: 'status-mcp' }, 41_000);
  assert.match(watch.reason(42_000)!, /stopped producing/);
});

void test('sleep and lost authority stop execution before the server reassigns it', () => {
  const watch = new ExecutionWatchdog(limits, 0, 20_000);
  watch.observe({ type: 'tool-start', id: 'build' }, 1);
  assert.equal(watch.reason(14_999), null);
  assert.match(watch.reason(15_000)!, /lease/);
  watch.renew(50_000);
  assert.equal(watch.reason(15_000), null);
  assert.match(watch.reason(500_000)!, /lease/);
});

void test('provider activity includes tool boundaries but excludes the agent status tool', () => {
  assert.deepEqual(
    codingActivity({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'one', name: 'Bash' },
          { type: 'tool_use', id: 'two', name: 'mcp__aiden_status__report_status' },
          { type: 'text', text: 'Checking the implementation' },
        ],
      },
    }),
    [{ type: 'tool-start', id: 'one' }, { type: 'output' }],
  );
  assert.deepEqual(
    codingActivity({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'one' }] },
    }),
    [{ type: 'tool-end', id: 'one' }],
  );
  assert.deepEqual(codingActivity(null), []);
  assert.deepEqual(codingActivity({ type: 'system' }), []);
});

void test('lost completion acknowledgement survives restart and never becomes a failure report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-receipt-'));
  try {
    const store = new Store(root);
    const receipt: CompletionReceipt = {
      taskId: 'task',
      projectId: 'project',
      deviceId: 'mac',
      attemptId: 'task:1',
      result: { pullRequestUrl: 'https://github.com/team/app/pull/1' },
      followUps: [],
      outcome: { durationSec: 10, usageBefore: null, usageAfter: null, costUsd: null },
      documentChanged: false,
      status: 'pending',
    };
    let calls = 0;
    const client = {
      complete: () => {
        if (++calls === 1) return Promise.reject(new AccountsError(0, 'unreachable', 'Offline'));
        return Promise.resolve();
      },
      fail: () => {
        throw new Error('Completed work must never be marked failed.');
      },
    } as unknown as AccountsClient;
    await saveReceipt(store, receipt);
    await assert.rejects(
      sendReceipt(store, client, receipt, async () => {}),
      /Offline/,
    );
    await flushReceipts(new Store(root), client, 'another-device', async () => {});
    assert.equal(calls, 1);
    await flushReceipts(new Store(root), client, 'mac', async () => {});
    await flushReceipts(new Store(root), client, 'mac', async () => {});
    assert.equal(calls, 2);
    const files = await readdir(path.join(root, 'team-completions'));
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'team-completions', files[0]!), 'utf8')).status,
      'acknowledged',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('publication recovery uses recorded commits without running a coding agent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-recover-'));
  try {
    const engine = {
      store: new Store(root),
      runtime: {
        run: () => {
          throw new Error('Must not rerun coding');
        },
      },
    } as unknown as Engine;
    const project = {
      id: 'project',
      repositories: [{ id: 'repo', path: root, source: { kind: 'github', name: 'team/app' } }],
    } as unknown as Project;
    const task = {
      title: 'Feature',
      role: 'fe_engineer',
      execution: {
        checkpoint: {
          summary: 'Built it',
          checks: ['Tests passed'],
          openQuestions: [{ question: 'Confirm the wording?', assigneeUserId: 'reviewer' }],
          repositories: [
            {
              repository: 'team/app',
              branch: 'aiden/job-00000000-0000-4000-8000-000000000001',
              baseBranch: 'main',
              commit: 'a'.repeat(40),
              pullRequestUrl: null,
            },
          ],
        },
      },
    } as unknown as AccountTask;
    let authorizations = 0;
    const saved: unknown[] = [];
    t.mock.method(publicationRecoveryServices, 'publish', async (input: PublicationInput) => {
      assert.equal(input.commit, 'a'.repeat(40));
      assert.equal(input.remoteOnly, true);
      await input.authorize?.();
      return 'https://github.com/team/app/pull/1';
    });
    const controls = {
      signal: new AbortController().signal,
      progress: () => {},
      authorize: () => {
        authorizations++;
        return Promise.resolve();
      },
      checkpoint: (value: unknown) => {
        saved.push(value);
        return Promise.resolve();
      },
    };
    const recovered = await recoverPublication(engine, project, task, controls);
    assert.equal(authorizations, 2);
    assert.equal(saved.length, 1);
    assert.equal(recovered.followUps?.[0]?.kind, 'coding-question');
    assert.equal(recovered.followUps?.[0]?.assigneeUserId, 'reviewer');
    assert.equal(recovered.followUps?.[0]?.role, 'fe_engineer');
    assert.equal(recovered.followUps?.[0]?.scope, 'task');
    // The recovered PRs go to the task's reviewer as a review packet, not a review-pr follow-up.
    assert.equal(recovered.followUps?.length, 1);
    assert.deepEqual(recovered.review, {
      summary: 'Built it',
      pullRequestUrls: ['https://github.com/team/app/pull/1'],
      checks: [
        {
          name: 'CI: team/app#1',
          kind: 'automated',
          state: 'pending',
          url: 'https://github.com/team/app/pull/1',
        },
      ],
    });
    t.mock.method(publicationRecoveryServices, 'publish', () =>
      Promise.reject(new MissingPublicationCommit()),
    );
    let blocked: unknown;
    await assert.rejects(
      recoverPublication(engine, project, task, {
        ...controls,
        block: (_title, _question, routing) => {
          blocked = routing;
          return Promise.resolve();
        },
      }),
      /previous machine/,
    );
    assert.deepEqual(blocked, { role: 'fe_engineer', scope: 'task' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
