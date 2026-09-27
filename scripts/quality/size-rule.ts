import type { Rule } from 'eslint';
import ts from 'typescript';

/** Recognize JSX returned by the component itself, excluding comments and nested callbacks. */
function returnsJsx(text: string): boolean {
  const tree = ts.createSourceFile('component.tsx', `(${text})`, ts.ScriptTarget.Latest, true);
  let root: ts.FunctionLikeDeclaration | undefined;
  let found = false;
  /** Unwrap transparent expressions and branches to detect a direct JSX return. */
  function expressionHasJsx(node: ts.Expression): boolean {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return expressionHasJsx(node.expression);
    if (ts.isConditionalExpression(node))
      return expressionHasJsx(node.whenTrue) || expressionHasJsx(node.whenFalse);
    return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
  }
  /** Visit only the outer function so a nested component cannot grant its parent an allowance. */
  function visit(node: ts.Node): void {
    if (
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node)
    ) {
      if (root && node !== root) return;
      root = node;
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) found ||= expressionHasJsx(node.body);
    }
    if (ts.isReturnStatement(node) && node.expression) found ||= expressionHasJsx(node.expression);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

/** Resolve declarations and assigned arrows; anonymous callbacks retain the ordinary limit. */
function functionName(node: Rule.Node): string {
  const parent = node.parent;
  return 'id' in node && node.id && 'name' in node.id
    ? String(node.id.name)
    : parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier'
      ? parent.id.name
      : 'function';
}

/** Enforce a JSX component allowance without relaxing other functions in TSX files. */
export const functionSizeRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { oversized: '{{name}} has {{actual}} code lines; the limit is {{limit}}.' },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      ':function'(node: Rule.Node) {
        if (!node.loc) return;
        const name = functionName(node);
        const component =
          /^[A-Z]/.test(name) &&
          /\.[jt]sx$/.test(context.filename) &&
          returnsJsx(source.getText(node));
        const limit = component ? 150 : 100;
        const tokens = source.getTokens(node);
        const occupied = new Set<number>();
        for (const token of tokens) {
          if (!token.loc) continue;
          for (let line = token.loc.start.line; line <= token.loc.end.line; line++) {
            if (source.lines[line - 1]?.trim()) occupied.add(line);
          }
        }
        // Tokens exclude comments; template literals/JSX text may span blank lines.
        if (occupied.size > limit)
          context.report({
            node,
            messageId: 'oversized',
            data: { name, actual: occupied.size, limit },
          });
      },
    };
  },
};
