import { Node, SyntaxKind, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";

/**
 * Collects literal first-argument keys of `<var>.<method>("key", …)` and `<var>.searchParams.<method>("key", …)`
 * calls in the variable's enclosing block. Best effort: order and conditionals are ignored.
 */
export function collectAppendedKeys(varExpr: Expression, methods: string[]): string[] {
  const u = unwrap(varExpr);
  if (!Node.isIdentifier(u)) return [];
  const keys: string[] = [];
  const name = u.getText();
  const scope = u.getSymbol()?.getDeclarations()[0]?.getFirstAncestor((n) => Node.isBlock(n) || Node.isSourceFile(n));
  for (const call of scope?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? []) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !methods.includes(callee.getName())) continue;
    const target = callee.getExpression().getText().replace(/\s/g, "");
    if (target !== name && target !== `${name}.searchParams`) continue;
    const k = call.getArguments()[0];
    if (k && Node.isStringLiteral(k)) keys.push(k.getLiteralValue());
  }
  return keys;
}
