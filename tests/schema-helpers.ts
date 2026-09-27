import assert from 'node:assert/strict';

// Check the provider's constraint against actual runtime requests, not just a schema snapshot.
export function assertStrictOutputSchema(node: unknown, location = '$'): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((value, i) => assertStrictOutputSchema(value, `${location}[${i}]`));
    return;
  }
  const schema = node as Record<string, any>;
  for (const key of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
  ]) {
    if (key in schema)
      assert.equal(typeof schema[key], 'number', `${location}: ${key} must be a number`);
  }
  if (schema.type === 'object' || schema.properties) {
    assert.equal(
      schema.additionalProperties,
      false,
      `${location}: additional properties must be forbidden`,
    );
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      Object.keys(schema.properties ?? {}).sort(),
      `${location}: required must include every property`,
    );
  }
  // Traverse schema positions, not property-name maps or literal enum/const data.
  for (const key of ['properties', '$defs', 'definitions', 'patternProperties']) {
    for (const [name, value] of Object.entries(schema[key] ?? {}))
      assertStrictOutputSchema(value, `${location}.${key}.${name}`);
  }
  for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not'])
    if (key in schema) assertStrictOutputSchema(schema[key], `${location}.${key}`);
}
