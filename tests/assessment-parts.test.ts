import assert from 'node:assert/strict';
import test from 'node:test';

import type { Findings, Product } from '../packages/contracts/src/index.js';
import {
  assessInParts,
  assessmentParts,
  partValidators,
} from '../packages/core/src/assessment-parts.js';
import type { ModelStage } from '../packages/core/src/model-stage.js';

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `REQ-${from + i}`);

void test('parts follow the delivery plan, keep features together, and split oversized features', () => {
  const plan = [
    { requirementIds: ids(3) },
    { requirementIds: ids(6, 4) },
    { requirementIds: ids(2, 10) },
  ] as Product['deliveryPlan'];
  assert.deepEqual(
    assessmentParts(ids(12), plan).map((part) => part.length),
    [3, 8, 1],
  );
  assert.deepEqual(assessmentParts(ids(12), plan).at(-1), ['REQ-12']);
  assert.deepEqual(
    assessmentParts(ids(20), undefined).map((part) => part.length),
    [8, 8, 4],
  );
  assert.deepEqual(assessmentParts(ids(5), undefined), [ids(5)]);
});

void test('a large baseline is assessed part by part and merged in requirement order', async () => {
  const product = {
    overview: 'x',
    milestones: [],
    requirements: ids(10).map((id) => ({ id, text: `${id} text` })),
  } as unknown as Product;
  const calls: { part: string | undefined; ids: string[]; others: number }[] = [];
  const stage = ((_name: string, _schema: unknown, input: unknown, validate, part) => {
    const given = input as { baseline: Product; otherRequirements?: unknown[] };
    const partIds = given.baseline.requirements.map((r) => r.id);
    calls.push({ part, ids: partIds, others: given.otherRequirements?.length ?? 0 });
    return Promise.resolve(
      validate({
        assessments: [...partIds].reverse().map((requirementId) => ({ requirementId })),
        risks: ['shared risk', `risk ${part}`],
        dependencies: [],
        unknowns: [],
      }),
    );
  }) as ModelStage;
  const findings = await assessInParts(stage, product, undefined, {}, (v, part) => {
    const value = v as Findings;
    assert.deepEqual(
      value.assessments.map((a) => a.requirementId).sort(),
      part.requirements.map((r) => r.id).sort(),
    );
    return value;
  });
  assert.deepEqual(
    calls.map((c) => [c.part, c.ids.length, c.others]),
    [
      ['1', 8, 2],
      ['2', 2, 8],
    ],
  );
  assert.deepEqual(
    findings.assessments.map((a) => a.requirementId),
    ids(10),
  );
  assert.deepEqual(findings.risks, ['shared risk', 'risk 1', 'risk 2']);
});

void test('parts running at once accept a candidate that fits any part, and a new run starts fresh', () => {
  /** A validator that accepts only answers for one part. */
  const only = (part: number) => (value: unknown) => {
    if ((value as { part?: number }).part !== part) throw new Error(`not part ${part}`);
    return value;
  };
  const register = partValidators();
  register('assess', only(1), '1');
  const check = register('assess', only(2), '2');
  assert.deepEqual(check({ part: 1 }), { part: 1 });
  assert.deepEqual(check({ part: 2 }), { part: 2 });
  assert.throws(() => check({ part: 3 }), /not part 1/);
  const fresh = register('assess', only(3));
  assert.throws(() => fresh({ part: 1 }), /not part 3/);
  assert.deepEqual(register('understand', only(9))({ part: 9 }), { part: 9 });
});
