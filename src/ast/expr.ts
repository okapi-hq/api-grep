import { Node, SyntaxKind, type Expression } from "ts-morph";

/** Strips parentheses, casts, non-null assertions and awaits. */
export function unwrap(e: Expression): Expression {
  let cur = e;
  for (;;) {
    if (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur) || Node.isNonNullExpression(cur)) cur = cur.getExpression();
    else if (Node.isSatisfiesExpression(cur) || Node.isTypeAssertion(cur) || Node.isAwaitExpression(cur)) cur = cur.getExpression();
    else return cur;
  }
}

/** No value: `null`, `undefined`, `false`, `void 0`. */
export const isNothing = (e: Expression): boolean => Node.isNullLiteral(e) || Node.isFalseLiteral(e) || (Node.isIdentifier(e) && e.getText() === "undefined") || Node.isVoidExpression(e);
const isBuilt = (e: Expression): boolean => Node.isCallExpression(e) || Node.isNewExpression(e);

/**
 * The value a guard yields when it yields one (`unwrap` first): `key ? new Resend(key) : null`, `url && createClient(url)`,
 * `globalThis.db ?? createClient(url)` (the other side is the same client, kept from an earlier run). The other branch
 * is no value at all, so the client is the only thing the code can call; two built branches stay as they are.
 */
export function guardedValue(e: Expression): Expression {
  let cur = unwrap(e);
  for (let i = 0; i < 4; i++) {
    let next: Expression | undefined;
    if (Node.isConditionalExpression(cur)) {
      const [a, b] = [unwrap(cur.getWhenTrue()), unwrap(cur.getWhenFalse())];
      next = isNothing(b) ? a : isNothing(a) ? b : undefined;
    } else if (Node.isBinaryExpression(cur)) {
      const op = cur.getOperatorToken().getKind();
      const right = unwrap(cur.getRight());
      if (op === SyntaxKind.AmpersandAmpersandToken) next = right;
      else if ((op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken) && isBuilt(right) && !isBuilt(unwrap(cur.getLeft()))) next = right;
    }
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

export interface Chain {
  root: Expression;
  /** nodes[i] is the expression covering root + chain[0..i-1]. */
  nodes: Expression[];
  chain: string[];
}

/** `a.b.c` -> root `a`, chain ["b", "c"]; supports `a["b"]`. */
export function memberChain(expr: Expression): Chain {
  const names: string[] = [];
  const nodes: Expression[] = [];
  let cur = unwrap(expr);
  for (;;) {
    if (Node.isPropertyAccessExpression(cur)) {
      names.unshift(cur.getName());
      nodes.unshift(cur);
      cur = unwrap(cur.getExpression());
      continue;
    }
    const arg = Node.isElementAccessExpression(cur) ? cur.getArgumentExpression() : undefined;
    if (!Node.isElementAccessExpression(cur) || !Node.isStringLiteral(arg)) break;
    names.unshift(arg.getLiteralValue());
    nodes.unshift(cur);
    cur = unwrap(cur.getExpression());
  }
  nodes.unshift(cur);
  return { root: cur, nodes, chain: names };
}

export function isStringLike(e: Expression | undefined): boolean {
  if (!e) return false;
  const u = unwrap(e);
  return Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) || Node.isTemplateExpression(u);
}

/** The `undefined` identifier (`{ body: undefined }`), casts aside. */
export function isUndefinedLiteral(e: Expression): boolean {
  const u = unwrap(e);
  return Node.isIdentifier(u) && u.getText() === "undefined";
}

/** Name of the constructor in `new X(...)` as written (`URL`, `Request`, `Headers`). */
export function constructedName(e: Expression): string | undefined {
  return Node.isNewExpression(e) ? e.getExpression().getText() : undefined;
}
