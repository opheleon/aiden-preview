import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchWorkerLine } from '../packages/core/src/worker-protocol.js';

void test('worker protocol rejects malformed, oversized, and nonallowlisted requests', async () => {
  for (const line of [
    '{',
    'null',
    'x'.repeat(2_000_001),
    JSON.stringify({ protocol: '2.0', id: 1, method: 'allowed' }),
    JSON.stringify({ protocol: '1.0', id: {}, method: 'allowed' }),
  ]) {
    const reply = await dispatchWorkerLine(line, {});
    assert.ok(reply.error);
    assert.equal(reply.id, null);
  }
  const reply = await dispatchWorkerLine(
    JSON.stringify({ protocol: '1.0', id: 4, method: 'toString' }),
    {},
  );
  assert.equal(reply.id, 4);
  assert.match(reply.error?.message ?? '', /Unknown operation/);
});

void test('worker protocol preserves identity and data, supplies empty params, and redacts failures', async () => {
  const methods = {
    echo: (params: unknown) => params,
    empty: () => undefined,
    failure: () => {
      throw new Error('Bearer synthetic-credential');
    },
  };
  const request = (method: string, params?: unknown) =>
    dispatchWorkerLine(
      JSON.stringify({
        protocol: '1.0',
        id: 'request',
        method,
        ...(params === undefined ? {} : { params }),
      }),
      methods,
    );
  assert.deepEqual(await request('echo'), { id: 'request', result: {} });
  assert.deepEqual(await request('echo', { value: [1, 2] }), {
    id: 'request',
    result: { value: [1, 2] },
  });
  assert.deepEqual(await request('empty'), { id: 'request', result: null });
  assert.doesNotMatch(JSON.stringify(await request('failure')), /synthetic-credential/);
});
