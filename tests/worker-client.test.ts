import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { WorkerClient } from '../packages/core/src/client.js';
import { required } from './required.js';

function transport(timeout = 50) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kills: 0,
    kill() {
      this.kills++;
      child.emit('exit', 0);
      return true;
    },
  });
  const requests: any[] = [];
  child.stdin.on('data', (value) => requests.push(JSON.parse(String(value))));
  const client = new WorkerClient(
    {},
    {
      requestTimeoutMs: timeout,
      createProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    },
  );
  return {
    child,
    client,
    requests,
    reply(value: unknown) {
      child.stdout.write(JSON.stringify(value) + '\n');
    },
    close() {
      client.close();
      child.emit('exit', 0);
    },
  };
}

void test('worker transport correlates replies and forwards validated events', async () => {
  const t = transport();
  try {
    const events: unknown[] = [];
    t.client.on('event', (e) => events.push(e));
    const first = t.client.request('projects');
    const second = t.client.request('diagnostics');
    t.reply({ id: required(t.requests[1]).id, result: ['second'] });
    t.reply({ id: required(t.requests[0]).id, result: ['first'] });
    assert.deepEqual(await first, ['first']);
    assert.deepEqual(await second, ['second']);
    t.reply({ event: { type: 'progress', runId: 'run', message: 'Working' } });
    t.reply({ event: { type: 'progress', runId: 'run', stage: 'verify', message: 'REQ-1: pass' } });
    const line = "1 of 1 criteria verified. 0 failed. 0 couldn't be verified.";
    t.reply({
      event: {
        type: 'completed',
        runId: 'run',
        stage: 'complete',
        verification: { total: 1, verified: 1, failed: 0, unverified: 0, line },
      },
    });
    assert.equal(events.length, 3);
    const failed = t.client.request('projects');
    t.reply({ id: required(t.requests[2]).id, error: { message: 'Unavailable' } });
    await assert.rejects(failed, /Unavailable/);
  } finally {
    t.close();
  }
});

void test('a timed-out request is not retried and a late reply is ignored', async () => {
  const t = transport(10);
  try {
    await assert.rejects(t.client.request('projects'), /may still be running/);
    assert.equal(t.requests.length, 1);
    t.reply({ id: required(t.requests[0]).id, result: [] });
    const next = t.client.request('projects');
    t.reply({ id: required(t.requests[1]).id, result: [] });
    await next;
  } finally {
    t.close();
  }
});

void test('invalid JSON, invalid events, oversized replies, and malformed envelopes fail closed', async () => {
  for (const response of [
    'not-json',
    JSON.stringify({ event: { type: 'invented', runId: 'x' } }),
    JSON.stringify({ id: 'string-id' }),
    'x'.repeat(2_000_001),
  ]) {
    const t = transport();
    let stopped = 0;
    t.client.on('workerStopped', () => stopped++);
    const pending = t.client.request('projects');
    t.child.stdout.write(response + '\n');
    await assert.rejects(pending, /invalid response/);
    assert.equal(stopped, 1);
    assert.equal(t.child.kills, 1);
    await assert.rejects(t.client.request('projects'), /closed/);
    t.close();
  }
});

void test('exit, spawn failure, stdin failure, and explicit shutdown settle pending requests once', async () => {
  for (const failure of ['exit', 'error', 'stdin', 'close']) {
    const t = transport();
    let stopped = 0;
    t.client.on('workerStopped', () => stopped++);
    const pending = t.client.request('projects');
    if (failure === 'close') t.client.close();
    else if (failure === 'stdin') t.child.stdin.emit('error', new Error('fixture'));
    else t.child.emit(failure, new Error('fixture'));
    await assert.rejects(pending);
    t.child.emit('exit', 0);
    assert.equal(stopped, 1);
    t.close();
  }
  assert.throws(() => new WorkerClient({}, { requestTimeoutMs: 0 }), /Invalid/);
});
