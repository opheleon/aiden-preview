import assert from 'node:assert/strict';
import test from 'node:test';

import {
  externalPayload,
  nextCursor,
  normalizedHistory,
  paginationComplete,
  recordArray,
} from '../packages/core/src/history-normalization.js';
import { required } from './required.js';

void test('MCP payload parsing stays data-only and bounds recursive record containers', () => {
  assert.deepEqual(externalPayload({ structuredContent: [1], content: [] }), [1]);
  assert.deepEqual(externalPayload({ content: [{ type: 'text', text: '{"issues":[1]}' }] }), {
    issues: [1],
  });
  assert.deepEqual(externalPayload({ content: [{ type: 'text', text: 'plain' }] }), {
    text: 'plain',
  });
  assert.equal(externalPayload(null), null);
  assert.deepEqual(externalPayload({ content: [{ type: 'image' }] }), {
    content: [{ type: 'image' }],
  });
  assert.deepEqual(recordArray({ data: { issues: [1] } }), [1]);
  assert.deepEqual(recordArray(null), []);
  const cycle: any = {};
  cycle.data = cycle;
  assert.deepEqual(recordArray(cycle), []);
});

void test('pagination requires evidence of completion', () => {
  assert.equal(nextCursor({ nextCursor: 'next' }), 'next');
  assert.equal(nextCursor({ pageInfo: { hasNextPage: true, endCursor: 'end' } }), 'end');
  assert.equal(nextCursor({ pageInfo: { hasNextPage: false } }), null);
  assert.equal(nextCursor(null), null);
  assert.equal(paginationComplete({ pageInfo: { hasNextPage: false } }, 100, null), true);
  assert.equal(paginationComplete({ next_cursor: null }, 100, null), true);
  assert.equal(paginationComplete({}, 100, 100), false);
  assert.equal(paginationComplete(null, 4, 10), true);
  assert.equal(paginationComplete({}, 0, null), false);
});

void test('history normalization rejects duplicates, malformed identifiers, invalid dates, and negative durations', () => {
  const result = normalizedHistory(
    [
      null,
      { id: {}, title: 'invalid' },
      {
        id: 'one',
        title: 'First',
        startedAt: '2026-01-01',
        completedAt: '2026-01-03',
        url: 'https://example.com/1',
      },
      { id: 'one', title: 'Duplicate' },
      {
        id: 2,
        key: 'TWO',
        name: 'Second',
        started_at: 'bad',
        completed_at: '2026-01-03',
        url: 'javascript:alert(1)',
      },
      { id: 'three', title: 'Third', startedAt: '2026-01-03', completedAt: '2026-01-01' },
    ],
    'connection',
    'team',
  );
  assert.equal(result.rows.length, 3);
  assert.equal(result.limitations.length, 3);
  assert.equal(required(result.rows[0])?.observedCalendarDays, 2);
  assert.equal(required(result.rows[1])?.startedAt, null);
  assert.equal(required(result.rows[1])?.url, undefined);
  assert.equal(required(result.rows[2])?.observedCalendarDays, null);
});
