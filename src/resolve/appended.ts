import { Node, SyntaxKind, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";

export interface AppendedEntry {
  key: string;
  value?: Expression;
}

/**
 * Collects literal first-argument keys (and the value expression) of `<var>.<method>("key", value)` and
 * `<var>.searchParams.<method>("key", value)` calls in the variable's enclosing block.
 * Best effort: order and conditionals are ignored.
 */
export function collectAppended(varExpr: Expression, methods: string[]): AppendedEntry[] {
  const u = unwrap(varExpr);
  if (!Node.isIdentifier(u)) return [];
  const entries: AppendedEntry[] = [];
  const name = u.getText();
  const scope = u.getSymbol()?.getDeclarations()[0]?.getFirstAncestor((n) => Node.isBlock(n) || Node.isSourceFile(n));
  for (const call of scope?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? []) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !methods.includes(callee.getName())) continue;
    const target = callee.getExpression().getText().replace(/\s/g, "");
    if (target !== name && target !== `${name}.searchParams`) continue;
    const [k, v] = call.getArguments() as Expression[];
    if (k && Node.isStringLiteral(k)) entries.push({ key: k.getLiteralValue(), value: v });
  }
  return entries;
}

export function collectAppendedKeys(varExpr: Expression, methods: string[]): string[] {
  return collectAppended(varExpr, methods).map((e) => e.key);
}
