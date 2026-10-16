import { Node, SyntaxKind, type Expression } from "ts-morph";
import { constructedName, isUndefinedLiteral, unwrap } from "../ast/expr.js";
import { bindingElementValue, declarationsOf } from "../ast/object.js";
import type { BodyEncoding, EvalCtx, Shape } from "../types.js";
import { collectAppendedKeys } from "./appended.js";
import { evaluate, staticText } from "./evaluate.js";
import { jsonToShape } from "./shape-utils.js";

/** How a request body expression is encoded: `JSON.stringify`, form helpers, `URLSearchParams`, `FormData`, XML. */

function appendedKeys(varExpr: Expression): string[] {
  return collectAppendedKeys(varExpr, ["append", "set"]);
}

export function keysToShape(keys: string[]): Shape {
  const properties: Record<string, Shape> = {};
  for (const k of keys) properties[k] = { type: "string" };
  return { type: "object", properties, required: keys, ...(keys.length === 0 ? { dynamicKeys: true } : {}) };
}

const FORM_STRINGIFY_RE = /^(qs|querystring|queryString)\.stringify$|^stringify$/;

/** `body ? JSON.stringify(body) : undefined` → the defined branch; `x.toString()` → x. */
function stripBodyWrappers(expr: Expression): Expression {
  const u = unwrap(expr);
  if (Node.isConditionalExpression(u)) {
    const [a, b] = [unwrap(u.getWhenTrue()), unwrap(u.getWhenFalse())];
    if (isUndefinedLiteral(b) || b.getKind() === SyntaxKind.NullKeyword) return stripBodyWrappers(a);
    if (isUndefinedLiteral(a) || a.getKind() === SyntaxKind.NullKeyword) return stripBodyWrappers(b);
  }
  if (Node.isCallExpression(u) && u.getArguments().length === 0) {
    const callee = u.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === "toString") return stripBodyWrappers(callee.getExpression());
  }
  return u;
}

export function unwrapEncoding(expr: Expression, ctx: EvalCtx, depth: number): { inner?: Expression; encoding: BodyEncoding; keys?: string[] } {
  const u = stripBodyWrappers(expr);
  if (Node.isCallExpression(u)) {
    const callee = u.getExpression().getText().replace(/\s/g, "");
    if (callee === "JSON.stringify") return { inner: u.getArguments()[0] as Expression | undefined, encoding: "json" };
    if (FORM_STRINGIFY_RE.test(callee)) return { inner: u.getArguments()[0] as Expression | undefined, encoding: "form" };
    // `new XMLSerializer().serializeToString(doc)`: an XML document built with the DOM, its text unread
    if (callee.endsWith(".serializeToString")) return { inner: u, encoding: "xml" };
  }
  if (Node.isNewExpression(u)) {
    const name = constructedName(u);
    const arg = u.getArguments()[0] as Expression | undefined;
    if (name === "URLSearchParams") return { inner: arg, encoding: "form", keys: appendedKeys(expr) };
    if (name === "FormData") return { inner: undefined, encoding: "multipart", keys: appendedKeys(expr) };
  }
  if (Node.isIdentifier(u) && depth < 3) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : decl ? bindingElementValue(decl, ctx) : undefined;
    if (init) {
      const inner = unwrapEncoding(init, ctx, depth + 1);
      if (inner.encoding !== "json" || inner.inner !== unwrap(init)) return { ...inner, keys: [...(inner.keys ?? []), ...appendedKeys(u)] };
    }
  }
  return { inner: u, encoding: "json" };
}

export function parseJsonString(u: Expression, ctx: EvalCtx): Shape | undefined {
  const text = staticText(evaluate(u, ctx));
  if (text === undefined) return undefined;
  try {
    return jsonToShape(JSON.parse(text));
  } catch {
    return undefined;
  }
}
