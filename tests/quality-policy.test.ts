import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';

import { physicalLines } from '../scripts/quality/files.js';
import { functionSizeRule } from '../scripts/quality/size-rule.js';
import { inspectSource } from '../scripts/quality/source-policy.js';

void test('physical source limits include blanks and comments, but exempt tests', () => {
  assert.equal(physicalLines(''), 0);
  assert.equal(physicalLines('x\n'), 1);
  const boundary = '// documented\n'.repeat(500);
  assert.deepEqual(inspectSource('packages/example.ts', boundary), []);
  assert.match(inspectSource('packages/example.ts', boundary + '\n').join(), /501 physical lines/);
  assert.deepEqual(inspectSource('tests/example.test.ts', boundary + '\n'), []);
  assert.match(inspectSource('scripts/example.mjs', 'export {};').join(), /must be TypeScript/);
});

void test('test focus and skips cannot be hidden, and suppressions need a specific reason', () => {
  assert.match(
    inspectSource('tests/example.test.ts', "test.describe.only('suite', () => {});").join(),
    /focused test/,
  );
  assert.match(
    inspectSource('tests/example.test.ts', "test('case', { skip: true }, () => {});").join(),
    /Reason comment/,
  );
  assert.deepEqual(
    inspectSource(
      'tests/example.test.ts',
      "// Reason: Provider credentials are unavailable in credential-free checks.\ntest.skip('live', () => {});",
    ),
    [],
  );
  assert.deepEqual(inspectSource('scripts/example.ts', "const message = 'eslint-disable';"), []);
  assert.match(inspectSource('scripts/example.ts', '// eslint-disable\n').join(), /explicit rules/);
  assert.deepEqual(
    inspectSource(
      'scripts/example.ts',
      '// eslint-disable-next-line no-console -- Release progress is intended for the terminal.\nconsole.log(1);',
    ),
    [],
  );
});

void test('function boundaries exclude blank/comment lines and reserve 150 for components', () => {
  const linter = new Linter();
  const config = {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser },
    plugins: { aiden: { rules: { size: functionSizeRule } } },
    rules: { 'aiden/size': 'error' as const },
  };
  const check = (source: string, filename = 'example.ts') =>
    linter.verify(source, config, { filename });
  const regular = (lines: number) => `function work() {\n${'  work();\n'.repeat(lines - 2)}}`;
  assert.equal(check(regular(100)).length, 0);
  assert.match(check(regular(101))[0]?.message ?? '', /limit is 100/);
  assert.equal(check(regular(100).replace('{\n', '{\n\n// explanation\n')).length, 0);
  assert.match(
    check(regular(101).replace('work', 'Utility'), 'example.tsx')[0]?.message ?? '',
    /limit is 100/,
  );
  const component = (lines: number) =>
    `function Component() {\n${'  work();\n'.repeat(lines - 3)}  return <div />;\n}`;
  assert.equal(check(component(150), 'example.tsx').length, 0);
  assert.match(check(component(151), 'example.tsx')[0]?.message ?? '', /limit is 150/);
});

void test('the production JSDoc policy rejects undocumented named helpers and exported contracts', async () => {
  const [{ default: configuration }, { default: jsdoc }] = await Promise.all([
    import('../eslint.config.js'),
    import('eslint-plugin-jsdoc'),
  ]);
  const production = configuration.find((entry) => entry.rules?.['jsdoc/require-jsdoc']);
  assert.ok(production?.rules);
  const linter = new Linter();
  const rules = {
    'jsdoc/require-jsdoc': production.rules['jsdoc/require-jsdoc'],
  } as Linter.RulesRecord;
  const options = { files: ['**/*.ts'], languageOptions: { parser }, plugins: { jsdoc }, rules };
  for (const source of [
    'function helper() { return 1; }',
    'const helper = () => 1;',
    'export interface Contract { value: string }',
    'export type Contract = string;',
  ]) {
    assert.ok(
      linter
        .verify(source, options, { filename: 'production.ts' })
        .some((message) => message.ruleId === 'jsdoc/require-jsdoc'),
    );
  }
  assert.deepEqual(
    linter.verify(
      '/** Read the fixture value without performing I/O. */\nfunction helper() { return 1; }',
      options,
      { filename: 'production.ts' },
    ),
    [],
  );
  assert.deepEqual(
    linter.verify('[1].map(value => value + 1);', options, { filename: 'production.ts' }),
    [],
  );
});
