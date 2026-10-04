import assert from 'node:assert/strict';
import test from 'node:test';

import type { Product, TriageItem } from '../packages/contracts/src/index.js';
import {
  appChecks,
  checkItems,
  itemKey,
  maxAppChecks,
  planSummary,
  reconcilePlan,
} from '../packages/core/src/triage.js';

const product: Product = {
  overview: 'Calendar',
  milestones: [],
  requirements: [
    {
      id: 'REQ-1',
      text: 'Drag an event to reschedule it.',
      edgeCases: [
        { id: 'E1', text: 'Dragging into next month keeps the event.', origin: 'scope' },
        { id: 'E2', text: 'Viewers cannot drag.', origin: 'found' },
      ],
    },
    { id: 'REQ-2', text: 'Reminders are emailed.' },
  ],
};

/** A plan entry for one item. */
const entry = (
  requirementId: string,
  edgeCaseId: string | null,
  method: TriageItem['method'],
  persona: string | null = null,
): TriageItem => ({ requirementId, edgeCaseId, method, persona, reason: 'Synthetic reason.' });

void test('every requirement main path comes before its edge cases, with stable keys', () => {
  const items = checkItems(product);
  assert.deepEqual(
    items.map((i) => i.key),
    ['REQ-1', 'REQ-1-E1', 'REQ-1-E2', 'REQ-2'],
  );
  assert.equal(items[1]?.requirement, 'Drag an event to reschedule it.');
  assert.equal(items[1]?.text, 'Dragging into next month keeps the event.');
  assert.equal(itemKey('REQ-3', null), 'REQ-3');
});

void test('reconciling gives each item one entry and sends anything unplanned to the app', () => {
  const items = checkItems(product);
  const plan = reconcilePlan(items, [
    entry('REQ-2', null, 'code'),
    entry('REQ-2', null, 'person'),
    entry('REQ-9', null, 'app'),
    entry('REQ-1', 'E2', 'app', 'a viewer without edit rights'),
  ]);
  assert.deepEqual(
    plan.map((p) => [itemKey(p.requirementId, p.edgeCaseId), p.method]),
    [
      ['REQ-1', 'app'],
      ['REQ-1-E1', 'app'],
      ['REQ-1-E2', 'app'],
      ['REQ-2', 'code'],
    ],
  );
  assert.match(plan[0]!.reason, /Not in the plan/);
  assert.match(reconcilePlan(items, null)[0]!.reason, /could not plan/);
});

void test('app checks carry personas, run main paths first, and are capped', () => {
  const items = checkItems(product);
  const plan = reconcilePlan(items, [
    entry('REQ-1', 'E2', 'app', 'a viewer without edit rights'),
    entry('REQ-2', null, 'code'),
  ]);
  const { checks, deferred } = appChecks(items, plan);
  assert.deepEqual(
    checks.map((c) => c.key),
    ['REQ-1', 'REQ-1-E1', 'REQ-1-E2'],
  );
  assert.equal(checks[2]?.persona, 'a viewer without edit rights');
  assert.equal(deferred, 0);
  const many: Product = {
    overview: 'Many',
    milestones: [],
    requirements: Array.from({ length: 20 }, (_, i) => ({
      id: `REQ-${i + 1}`,
      text: `Requirement ${i + 1}`,
      edgeCases: [{ id: 'E1', text: `Edge ${i + 1}`, origin: 'scope' as const }],
    })),
  };
  const manyItems = checkItems(many);
  const capped = appChecks(manyItems, reconcilePlan(manyItems, null));
  assert.equal(capped.checks.length, maxAppChecks);
  assert.equal(capped.deferred, 40 - maxAppChecks);
  assert.ok(
    capped.checks.slice(0, 20).every((c) => !c.edgeCaseId),
    'main paths are kept first',
  );
  assert.equal(
    planSummary(plan),
    'Planned 4 checks: 3 in the app, 1 in the code, 0 that need a person.',
  );
});

void test('API checks are executed and counted separately from browser checks', () => {
  const items = checkItems(product);
  const plan = reconcilePlan(items, [entry('REQ-2', null, 'api')]);
  const selected = appChecks(items, plan).checks.find((item) => item.key === 'REQ-2');
  assert.equal(selected?.method, 'api');
  assert.match(planSummary(plan), /1 via API/);
});
