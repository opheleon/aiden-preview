import assert from 'node:assert/strict';
import test from 'node:test';

import { type DeliveryFeature, ProductSchema } from '../packages/contracts/src/index.js';
import { parseUnderstanding, savedProduct } from '../packages/core/src/understanding.js';
import { deliveryTickets } from '../packages/reporting/src/tickets.js';

const first: DeliveryFeature = {
  id: 'F-1',
  title: 'Private calendar',
  outcome: 'Sign in and see only your calendar.',
  kind: 'feature',
  rationale: 'Private access is needed before creating events.',
  requirementIds: ['REQ-1'],
  dependsOn: [],
};
const second: DeliveryFeature = {
  id: 'F-2',
  title: 'Create events',
  outcome: 'Create and retrieve an event.',
  kind: 'feature',
  rationale: 'Build on private access.',
  requirementIds: ['REQ-2'],
  dependsOn: ['F-1'],
};
const product = {
  overview: 'A private calendar.',
  milestones: [],
  requirements: [
    { id: 'REQ-1', text: 'Sign in.' },
    { id: 'REQ-2', text: 'Create an event.' },
  ],
  deliveryPlan: [first, second],
};

void test('delivery plans round-trip with complete ownership, stable order, and prerequisites', () => {
  assert.deepEqual(ProductSchema.parse(product), product);
  const understanding = {
    ...product,
    title: 'Calendar scheduling',
    requirements: product.requirements.map((r) => ({ ...r, edgeCases: [] })),
    repositories: [],
    calls: [],
    settledCalls: [],
  };
  assert.deepEqual(parseUnderstanding(understanding, null).deliveryPlan, [first, second]);
  assert.deepEqual(savedProduct(understanding).deliveryPlan, [first, second]);
});

void test('invalid ownership and dependencies cannot become a saved baseline or model result', () => {
  const invalid = [
    [second, first],
    [{ ...first, dependsOn: ['F-1'] }, second],
    [{ ...first, dependsOn: ['F-2'] }, second],
    [first, { ...second, dependsOn: ['F-9'] }],
    [first, { ...second, dependsOn: ['F-1', 'F-1'] }],
    [first, { ...second, id: 'F-1' }],
    [first],
    [first, { ...second, requirementIds: ['REQ-1', 'REQ-2'] }],
    [first, { ...second, requirementIds: ['REQ-9'] }],
  ];
  for (const deliveryPlan of invalid)
    assert.equal(ProductSchema.safeParse({ ...product, deliveryPlan }).success, false);
});

void test('legacy products and understand checkpoints load without inventing a delivery plan', () => {
  const legacy = { overview: product.overview, requirements: product.requirements, milestones: [] };
  assert.deepEqual(ProductSchema.parse(legacy), legacy);
  const checkpoint = {
    ...legacy,
    requirements: legacy.requirements.map((r) => ({ ...r, edgeCases: [] })),
    calls: [],
  };
  assert.equal(savedProduct(checkpoint).deliveryPlan, undefined);
  assert.throws(() => parseUnderstanding(checkpoint, null), /deliveryPlan/);
  assert.equal(parseUnderstanding(checkpoint, null, [], true).deliveryPlan, undefined);
});

void test('new foundation plans need a test plan while stored baselines remain compatible', () => {
  const foundation = { ...first, kind: 'platform' as const };
  const understanding = {
    ...product,
    title: 'Calendar storage',
    requirements: product.requirements.map((r) => ({ ...r, edgeCases: [] })),
    deliveryPlan: [foundation, second],
    calls: [],
    settledCalls: [],
    repositories: [],
  };
  assert.throws(() => parseUnderstanding(understanding, null), /requires a testPlan/);
  assert.equal(
    parseUnderstanding(understanding, null, [], true).deliveryPlan?.[0]?.testPlan,
    undefined,
  );
  const testPlan =
    'Create events through the migrated store, verify private reads, rejected unauthorized access, and rollback preserving records.';
  const planned = parseUnderstanding(
    { ...understanding, deliveryPlan: [{ ...foundation, testPlan }, second] },
    null,
  );
  assert.equal(savedProduct(planned).deliveryPlan?.[0]?.testPlan, testPlan);
  assert.match(
    deliveryTickets(savedProduct(understanding), undefined, [])[0]!.markdown,
    /Test plan needed before implementation/,
  );
  assert.ok(deliveryTickets(savedProduct(planned), undefined, [])[0]!.markdown.includes(testPlan));
});
