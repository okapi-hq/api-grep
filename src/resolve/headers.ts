import { Node, type Expression } from "ts-morph";
import { constructedName, unwrap } from "../ast/expr.js";
import { propertyKey, propertyValue, toObjectLiteral } from "../ast/object.js";
import type { EvalCtx } from "../types.js";
import { evaluate } from "./evaluate.js";
import { addHeader, type HeadersResult } from "./header-names.js";
import { typeToShape } from "./type-shape.js";

export type { HeadersResult } from "./header-names.js";

function collect(obj: Expression, ctx: EvalCtx, out: HeadersResult, depth: number): void {
  const lit = toObjectLiteral(obj, ctx, depth);
  if (!lit) {
    const t = typeToShape(unwrap(obj).getType(), obj).shape;
    if (t.type === "object" && Object.keys(t.properties).length > 0 && !t.dynamicKeys) {
      for (const k of Object.keys(t.properties)) pushName(out, k, undefined, ctx);
      return;
    }
    out.known = false;
    return;
  }
  for (const member of lit.getProperties()) {
    if (Node.isSpreadAssignment(member)) {
      if (depth < 3) collect(member.getExpression(), ctx, out, depth + 1);
      else out.known = false;
      continue;
    }
    const key = propertyKey(member);
    if (key === undefined) {
      out.known = false;
      continue;
    }
    pushName(out, key, propertyValue(member), ctx);
  }
}

function pushName(out: HeadersResult, key: string, value: Expression | undefined, ctx: EvalCtx): void {
  addHeader(out, key, value ? evaluate(value, ctx) : undefined);
}

/** Header names (lower-cased), non-credential literal values and the auth scheme from a headers expression. */
export function resolveHeaders(expr: Expression | undefined, ctx: EvalCtx = {}): HeadersResult {
  const out: HeadersResult = { names: [], values: {}, authScheme: "none", known: true };
  if (!expr) return out;
  let u = unwrap(expr);
  if (Node.isNewExpression(u) && constructedName(u) === "Headers") {
    const arg = u.getArguments()[0] as Expression | undefined;
    if (!arg) return { names: [], values: {}, authScheme: "unknown", known: false };
    u = arg;
  }
  collect(u, ctx, out, 0);
  if (!out.known && out.authScheme === "none") out.authScheme = "unknown";
  return out;
}
