import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import accessibility from 'eslint-plugin-jsx-a11y';
import hooks from 'eslint-plugin-react-hooks';
import imports from 'eslint-plugin-simple-import-sort';
import ts from 'typescript-eslint';

import { functionSizeRule } from './scripts/quality/size-rule.js';

const production = ['apps/**/*.{ts,tsx,cts}', 'packages/**/*.ts', 'scripts/**/*.ts'];
export default ts.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './apps/desktop/tsconfig.json',
          './tsconfig.verification.json',
        ],
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'simple-import-sort': imports },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
    },
  },
  {
    files: production,
    plugins: { jsdoc, aiden: { rules: { 'function-size': functionSizeRule } } },
    rules: {
      'aiden/function-size': 'error',
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: true },
          contexts: [
            'VariableDeclarator > ArrowFunctionExpression',
            'VariableDeclarator > FunctionExpression',
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
          ],
          exemptEmptyConstructors: true,
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': ['error', { typed: true }],
      'jsdoc/no-types': 'error',
    },
  },
  {
    files: ['apps/desktop/**/*.tsx'],
    plugins: { 'react-hooks': hooks, 'jsx-a11y': accessibility },
    rules: { ...hooks.configs.recommended.rules, ...accessibility.flatConfigs.recommended.rules },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      // Tests intentionally construct invalid external inputs to exercise validators.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettier,
);
