import ts from 'typescript';

import { isTestFile, physicalLines } from './files.js';

/** Inspect handwritten source without mistaking strings or regular expressions for directives. */
export function inspectSource(file: string, source: string): string[] {
  const errors: string[] = [];
  if (!/\.(?:[cm]?[jt]sx?|css|html)$/.test(file)) return errors;
  if (!isTestFile(file) && physicalLines(source) > 500)
    errors.push(`${file}: ${physicalLines(source)} physical lines exceeds 500`);
  if (/\.[cm]?jsx?$/.test(file))
    errors.push(`${file}: handwritten executable source must be TypeScript`);
  if (/\.(?:css|html)$/.test(file)) return errors;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    )
      continue;
    const comment = scanner.getTokenText();
    if (
      /eslint-disable/.test(comment) &&
      !/eslint-disable(?:-next-line|-line)?\s+[\w@/,-]+(?:\s*,\s*[\w@/-]+)*\s+--\s*\S.{9,}/.test(
        comment,
      )
    ) {
      errors.push(`${file}: suppression needs explicit rules and an explanation`);
    }
  }
  /** Validate test registration calls, including chained describe and skip options. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      if (/^(?:test|it|describe)(?:\.[\w]+)*\.only$/.test(name))
        errors.push(`${file}: focused test`);
      const options = node.arguments[1];
      const skips =
        /^(?:test|it|describe)(?:\.[\w]+)*\.(?:skip|skipIf|runIf)$/.test(name) ||
        (/^(?:test|it|describe)$/.test(name) &&
          options &&
          ts.isObjectLiteralExpression(options) &&
          options.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(tree) === 'skip' &&
              property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
          ));
      if (skips) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
        if (!/\/\/\s*Reason:\s*\S.{9,}/.test(source.split('\n')[line - 1] ?? ''))
          errors.push(`${file}: skipped test needs a preceding Reason comment`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}
