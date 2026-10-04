import assert from 'node:assert/strict';
import test from 'node:test';

import type { Baseline } from '../packages/contracts/src/index.js';
import {
  parseUnderstanding,
  productFromUnderstanding,
  savedProduct,
  type Understanding,
} from '../packages/core/src/understanding.js';

const understanding: Understanding = {
  title: 'Reschedule calendar events',
  repositories: [],
  overview: 'A calendar.',
  milestones: [],
  deliveryPlan: [
    {
      id: 'F-1',
      title: 'Reschedule an event',
      kind: 'feature',
      outcome: 'Move an event and see its local time.',
      rationale: 'One usable calendar interaction.',
      requirementIds: ['REQ-1', 'REQ-2'],
      dependsOn: [],
    },
  ],
  requirements: [
    {
      id: 'REQ-1',
      text: 'Drag an event to reschedule it.',
      edgeCases: [{ id: 'E1', text: 'Dragging into next month keeps the event.' }],
    },
    { id: 'REQ-2', text: 'Events show their time zone.', edgeCases: [] },
  ],
  calls: [
    {
      blocking: true,
      requirementId: 'REQ-1',
      edgeCaseId: null,
      question: 'Notify attendees when an event moves?',
      options: ['Notify', 'Move silently'],
      assumption: 'Move silently',
      owner: 'you',
    },
  ],
};

const previous = {
  retiredIds: ['REQ-3'],
  product: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }] },
} as unknown as Baseline;

void test('understanding splits into the baseline product and the calls to record', () => {
  const { product, calls } = productFromUnderstanding(understanding);
  assert.equal(product.title, 'Reschedule calendar events');
  assert.deepEqual(product.requirements[0]?.edgeCases, [
    { id: 'E1', text: 'Dragging into next month keeps the event.', origin: 'scope' },
  ]);
  assert.equal('edgeCases' in product.requirements[1]!, false, 'empty lists are omitted');
  assert.equal(calls.length, 1);
  assert.deepEqual(parseUnderstanding(understanding, previous), understanding);
});

void test('bad IDs and dangling call references are sent back to the model', () => {
  /** Understanding with one field replaced. */
  const withCalls = (calls: Understanding['calls']) => ({ ...understanding, calls });
  const call = understanding.calls[0]!;
  assert.throws(
    () =>
      parseUnderstanding(
        {
          ...understanding,
          deliveryPlan: [
            { ...understanding.deliveryPlan[0]!, requirementIds: ['REQ-1', 'REQ-2', 'REQ-3'] },
          ],
          requirements: [
            ...understanding.requirements,
            { id: 'REQ-3', text: 'Back', edgeCases: [] },
          ],
        },
        previous,
      ),
    /Retired/,
  );
  assert.throws(() =>
    parseUnderstanding(
      {
        ...understanding,
        requirements: [understanding.requirements[0]!, understanding.requirements[0]!],
      },
      null,
    ),
  );
  assert.throws(
    () => parseUnderstanding(withCalls([{ ...call, requirementId: null, edgeCaseId: 'E1' }]), null),
    /edge case without its requirement/,
  );
  assert.throws(
    () => parseUnderstanding(withCalls([{ ...call, requirementId: 'REQ-9' }]), null),
    /unknown requirement REQ-9/,
  );
  assert.throws(
    () => parseUnderstanding(withCalls([{ ...call, edgeCaseId: 'E4' }]), null),
    /unknown edge case E4/,
  );
  assert.throws(() => parseUnderstanding({ ...understanding, extra: true }, null));
  assert.equal(
    parseUnderstanding(withCalls([{ ...call, requirementId: null }]), null).calls.length,
    1,
  );
});

void test('saved checkpoints from before edge cases still load for review', () => {
  const legacy = {
    overview: 'Old',
    milestones: [],
    requirements: [{ id: 'REQ-1', text: 'Old requirement.' }],
  };
  assert.deepEqual(savedProduct(legacy), legacy);
  assert.equal(savedProduct(understanding).requirements[0]?.edgeCases?.[0]?.origin, 'scope');
  assert.throws(() => savedProduct({ overview: 'Broken' }));
});

void test('the repositories an intent is about narrow a look; all or none means the whole project', () => {
  const ids = ['repo-a', 'repo-b', 'repo-c'];
  const one = parseUnderstanding({ ...understanding, repositories: ['repo-b'] }, null, ids);
  assert.deepEqual(productFromUnderstanding(one, ids).product.repositories, ['repo-b']);
  const all = parseUnderstanding({ ...understanding, repositories: ids }, null, ids);
  assert.equal(productFromUnderstanding(all, ids).product.repositories, undefined);
  assert.equal(
    productFromUnderstanding({ ...understanding, repositories: [] }, ids).product.repositories,
    undefined,
  );
  assert.throws(
    () => parseUnderstanding({ ...understanding, repositories: ['repo-z'] }, null, ids),
    /repo-z is not in this project/,
  );
});

void test('new scopes require a name, while old checkpoints remain readable', () => {
  const legacy = { ...understanding, title: undefined };
  assert.throws(() => parseUnderstanding(legacy, null), /title/);
  assert.equal(parseUnderstanding(legacy, null, [], true).title, undefined);
  assert.equal(savedProduct(legacy).title, undefined);
});
