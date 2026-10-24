import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import heartbeat from '../packages/contracts/fixtures/accounts/task-heartbeat.json' with { type: 'json' };
import type { AccountTask } from '../packages/contracts/src/accounts-api.js';
import { AccountsClient, AccountsError } from '../packages/core/src/accounts/client.js';
import { statusTools } from '../packages/core/src/accounts/status-tools.js';
import { superviseCoding } from '../packages/runtimes/src/coding-supervision.js';
import type { RuntimeRequest, RuntimeResult } from '../packages/runtimes/src/types.js';

/** Synthetic request with no provider credentials or real model execution. */
function request(): RuntimeRequest {
  return {
    coding: { sessionId: 'fixture', limits: { idleMs: 2000, toolMs: 5000, absoluteMs: 10_000 } },
    config: { provider: 'claude', auth: 'subscription' },
    prompt: 'fixture',
    schema: {},
    cwd: '/tmp',
    tools: { url: '', token: '' },
    signal: new AbortController().signal,
    progress: () => {},
  };
}

void test('status reporting refreshes rejected OAuth once without changing the report or attempt', async () => {
  let token = 'expired-fixture';
  const calls: RequestInit[] = [];
  const api = new AccountsClient(
    'https://fixture.example',
    () => Promise.resolve(token),
    (_url, init) => {
      calls.push(init!);
      return Promise.resolve(
        calls.length === 1
          ? Response.json({ error: 'unauthorized', message: 'Expired' }, { status: 401 })
          : Response.json(heartbeat),
      );
    },
    () => {
      token = 'refreshed-fixture';
    },
  );
  await api.reportStatus(heartbeat.id, {
    deviceId: 'mac',
    attemptId: 'task:1',
    sequence: 1,
    state: 'progress',
    message: 'Testing',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.body, calls[1]!.body);
  assert.equal(new Headers(calls[0]!.headers).get('authorization'), 'Bearer expired-fixture');
  assert.equal(new Headers(calls[1]!.headers).get('authorization'), 'Bearer refreshed-fixture');
});

void test('runtime watchdog interrupts a hung subprocess even without another provider event', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  let interrupted = false;
  const run = superviseCoding(
    request(),
    (bounded) =>
      new Promise<RuntimeResult>((_, reject) => {
        bounded.signal.addEventListener('abort', () => {
          interrupted = true;
          reject(new Error('Stopped'));
        });
      }),
  );
  const stopped = assert.rejects(run, /stopped producing/);
  t.mock.timers.tick(2000);
  await stopped;
  assert.equal(interrupted, true);
});

void test('continuous observed output still cannot extend the absolute coding deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  let running!: RuntimeRequest;
  const run = superviseCoding(request(), (bounded) => {
    running = bounded;
    return new Promise<RuntimeResult>(() => {});
  });
  const stopped = assert.rejects(run, /runtime limit/);
  for (let second = 0; second < 10; second++) {
    running.activity?.({ type: 'output' });
    t.mock.timers.tick(1000);
  }
  await stopped;
  assert.equal(running.signal.aborted, true);
});

void test('quiet tool execution survives idle threshold but ends at its own deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  let running!: RuntimeRequest;
  const run = superviseCoding(request(), (bounded) => {
    running = bounded;
    return new Promise<RuntimeResult>(() => {});
  });
  const stopped = assert.rejects(run, /tool exceeded/);
  running.activity?.({ type: 'tool-start', id: 'test-command' });
  t.mock.timers.tick(3000);
  assert.equal(running.signal.aborted, false);
  t.mock.timers.tick(2000);
  await stopped;
});

void test('status MCP preflights OAuth and binds calls without exposing task routing to the model', async () => {
  const task = { id: 'task', execution: { attemptId: 'task:1' } } as AccountTask;
  let preflight = false;
  const reports: Record<string, unknown>[] = [];
  let failOnce = true;
  const api = {
    authorize: (_id: string, binding: unknown) => {
      assert.deepEqual(binding, { deviceId: 'device', attemptId: 'task:1' });
      preflight = true;
      return Promise.resolve(task);
    },
    reportStatus: (_id: string, report: Record<string, unknown>) => {
      reports.push(report);
      if (failOnce) {
        failOnce = false;
        return Promise.reject(new AccountsError(0, 'unreachable', 'Offline'));
      }
      return Promise.resolve({ status: 'leased', blockedBy: null });
    },
  } as unknown as AccountsClient;
  const gateway = await statusTools(api, task, 'device', () => {});
  const client = new Client({ name: 'execution-fixture', version: '1' });
  try {
    assert.equal(preflight, true);
    const unauthorized = await fetch(gateway.url, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(gateway.url), {
        requestInit: { headers: { authorization: `Bearer ${gateway.token}` } },
      }) as Transport,
    );
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ['report_status'],
    );
    assert.equal('taskId' in (listed.tools[0]!.inputSchema.properties ?? {}), false);
    const arguments_ = { state: 'progress', message: 'Running local tests' };
    const failed = await client.callTool({ name: 'report_status', arguments: arguments_ });
    assert.equal(failed.isError, true);
    const accepted = await client.callTool({ name: 'report_status', arguments: arguments_ });
    assert.notEqual(accepted.isError, true);
    assert.equal(reports[0]?.sequence, reports[1]?.sequence);
    assert.equal(reports[1]?.attemptId, 'task:1');
    const injected = await client.callTool({
      name: 'report_status',
      arguments: { ...arguments_, taskId: 'other-task' },
    });
    assert.equal(injected.isError, true);
    assert.equal(reports.length, 2);
    assert.equal(JSON.stringify(accepted).includes(gateway.token), false);
  } finally {
    await client.close();
    await gateway.close();
  }
});
