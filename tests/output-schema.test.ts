import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod/v3';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  ComplexityOutputSchema,
  DiscoverySchema,
  EvidenceSchema,
  FindingsSchema,
  HistoryClassificationOutputSchema,
  outputSchemaFor,
  ProductSchema,
  RemainingOutputSchema,
  schemaFor,
  SummarySchema,
  WorkItemSchema,
} from '../packages/contracts/src/index.js';
import { required } from './required.js';
import { assertStrictOutputSchema } from './schema-helpers.js';

void test('all model stages provide closed objects with every nested property required', () => {
  for (const schema of [
    ProductSchema,
    DiscoverySchema,
    FindingsSchema,
    SummarySchema,
    ComplexityOutputSchema,
    RemainingOutputSchema,
    HistoryClassificationOutputSchema,
  ]) {
    assertStrictOutputSchema(outputSchemaFor(schema));
  }
});

void test('exclusive numeric bounds use numbers, including nested evidence line ranges', () => {
  // Reproduce the upstream openAi converter output that causes the provider's
  // "True is not of type number" schema rejection.
  const raw = zodToJsonSchema(EvidenceSchema, { target: 'openAi' }) as any;
  assert.equal(raw.properties.startLine.exclusiveMinimum, true);
  assert.throws(() => assertStrictOutputSchema(raw), /exclusiveMinimum must be a number/);
  const findings = outputSchemaFor(FindingsSchema) as any;
  const evidence = findings.properties.assessments.items.properties.evidence.items;
  for (const key of ['startLine', 'endLine']) {
    assert.equal(evidence.properties[key].exclusiveMinimum, 0);
    assert.ok(!('minimum' in evidence.properties[key]));
  }
  const nested = z
    .object({
      values: z.array(z.number().gt(-2).lt(5).nullable()),
      inclusive: z.number().min(0).max(10),
    })
    .strict();
  const converted = outputSchemaFor(nested) as any;
  const number = converted.properties.values.items.anyOf.find((row: any) => row.type === 'number');
  assert.equal(number.exclusiveMinimum, -2);
  assert.equal(number.exclusiveMaximum, 5);
  assert.equal(converted.properties.inclusive.minimum, 0);
  assert.equal(converted.properties.inclusive.maximum, 10);
  assertStrictOutputSchema(converted);
  assert.throws(() =>
    EvidenceSchema.parse({
      repositoryId: 'repo',
      sha: 'abc',
      path: 'file.ts',
      startLine: 0,
      endLine: 1,
      explanation: 'test',
    }),
  );
});

void test('original and remaining estimates accept null shared keys without weakening work item validation', () => {
  const item = { id: 'REQ-1-work', text: 'Add a label', sharedKey: null };
  assert.deepEqual(WorkItemSchema.parse(item), item);
  assert.equal(WorkItemSchema.parse({ ...item, sharedKey: 'migration' }).sharedKey, 'migration');
  assert.throws(() => WorkItemSchema.parse({ ...item, sharedKey: 42 }));
  assert.throws(() => WorkItemSchema.parse({ ...item, text: null }));
  const row = {
    requirementId: 'REQ-1',
    size: 'XS',
    points: 1,
    reasoning: 'A bounded label change.',
    workType: 'ui',
    scopeShape: 'bounded_change',
    workItems: [item],
  };
  assert.equal(
    required(
      required(ComplexityOutputSchema.parse({ requirements: [row] }).requirements[0]).workItems[0],
    ).sharedKey,
    null,
  );
  assert.equal(
    required(
      required(
        RemainingOutputSchema.parse({
          requirements: [
            {
              requirementId: row.requirementId,
              size: row.size,
              points: row.points,
              reasoning: row.reasoning,
              estimable: true,
              comparisonMatches: [],
              workType: row.workType,
              scopeShape: row.scopeShape,
              workItems: [item],
              unknowns: [],
            },
          ],
        }).requirements[0],
      ).workItems[0],
    ).sharedKey,
    null,
  );
});

void test('legacy work items remain readable and ordinary tool schemas keep optional arguments', () => {
  const legacy = { id: 'work', text: 'Existing saved work item' };
  assert.deepEqual(WorkItemSchema.parse(legacy), legacy);
  const ordinary = schemaFor(WorkItemSchema) as any;
  const output = outputSchemaFor(WorkItemSchema) as any;
  assert.ok(!ordinary.required.includes('sharedKey'));
  assert.ok(output.required.includes('sharedKey'));
  assert.deepEqual(output.properties.sharedKey.type, ['string', 'null']);
});
