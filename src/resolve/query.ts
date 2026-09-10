import { Node, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { propertyKey, toObjectLiteral } from "../detect/options.js";
import type { DynamicPart, EvalCtx, Shape } from "../types.js";
import { shapeOf } from "./body.js";

export interface QueryResult {
  names: string[];
  shape: Record<string, Shape>;
  dynamic: DynamicPart[];
}

function isNullable(s: Shape): boolean {
  return s.type === "union" && s.anyOf.some((x) => x.type === "null");
}

function addProps(out: QueryResult, s: Shape, origin: string): void {
  if (s.type !== "object") return;
  for (const [k, v] of Object.entries(s.properties)) {
    if (!out.names.includes(k)) out.names.push(k);
    out.shape[k] = v;
    out.dynamic.push({ where: "query", name: k, origin, shape: v });
  }
}

function fromLiteral(lit: Expression, ctx: EvalCtx, out: QueryResult): void {
  if (!Node.isObjectLiteralExpression(lit)) return;
  for (const member of lit.getProperties()) {
    if (Node.isSpreadAssignment(member)) {
      const r = shapeOf(member.getExpression(), ctx, 1);
      addProps(out, r.shape, r.origin ?? "unknown");
      continue;
    }
    const key = propertyKey(member);
    if (key === undefined) continue;
    const value = Node.isPropertyAssignment(member) ? member.getInitializer() : Node.isShorthandPropertyAssignment(member) ? member.getNameNode() : undefined;
    if (!value || (Node.isIdentifier(unwrap(value)) && unwrap(value).getText() === "undefined")) continue;
    const r = shapeOf(value, ctx, 1);
    if (!out.names.includes(key)) out.names.push(key);
    out.shape[key] = r.shape;
    if (!r.fromLiteral) out.dynamic.push({ where: "query", name: key, origin: r.origin ?? (isNullable(r.shape) ? "type" : "unknown"), shape: r.shape });
  }
}

/** Query parameters from a `params` / `searchParams` style expression: names, per-key shapes and dynamic parts. */
export function resolveQuery(expr: Expression | undefined, ctx: EvalCtx = {}): QueryResult {
  const out: QueryResult = { names: [], shape: {}, dynamic: [] };
  if (!expr) return out;
  const lit = toObjectLiteral(expr, ctx);
  if (lit) {
    fromLiteral(lit, ctx, out);
    return out;
  }
  const r = shapeOf(expr, ctx, 1);
  addProps(out, r.shape, r.origin ?? "unknown");
  return out;
}
