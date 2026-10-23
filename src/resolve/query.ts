import { Node, type Expression } from "ts-morph";
import { isUndefinedLiteral } from "../ast/expr.js";
import { propertyKey, propertyValue, toObjectLiteral } from "../ast/object.js";
import type { DynamicPart, EvalCtx, Shape } from "../types.js";
import { shapeOf } from "./body.js";
import { evaluate } from "./evaluate.js";
import { staticText } from "./parts.js";
import { isNullable } from "./type-shape.js";

export interface QueryResult {
  names: string[];
  shape: Record<string, Shape>;
  dynamic: DynamicPart[];
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
    const value = propertyValue(member);
    if (!value || isUndefinedLiteral(value)) continue;
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

function merge(out: QueryResult, more: QueryResult): void {
  for (const k of more.names) if (!out.names.includes(k)) out.names.push(k);
  Object.assign(out.shape, more.shape);
  out.dynamic.push(...more.dynamic);
}

/** A `k=v&...` string's parameters, each value its literal text (`query("$filter=a eq 1")`). */
function fromQueryString(text: string, out: QueryResult): void {
  for (const pair of text.replace(/^\?/, "").split("&")) {
    const at = pair.indexOf("=");
    const key = at > 0 ? pair.slice(0, at) : "";
    if (!key) continue;
    if (!out.names.includes(key)) out.names.push(key);
    out.shape[key] = { type: "string", enum: [pair.slice(at + 1)] };
  }
}

/** The query parameters a fluent request builder's steps set (`RawCall.stepQuery`), added to `out`. */
export function addStepQuery(out: QueryResult, steps: { name?: string; value?: Expression }[] | undefined, ctx: EvalCtx = {}): void {
  for (const step of steps ?? []) {
    if (step.name === undefined) {
      const text = step.value ? staticText(evaluate(step.value, ctx)) : undefined;
      if (text !== undefined) fromQueryString(text, out);
      else if (step.value) merge(out, resolveQuery(step.value, ctx));
      continue;
    }
    const r = step.value ? shapeOf(step.value, ctx, 1) : undefined;
    if (!out.names.includes(step.name)) out.names.push(step.name);
    out.shape[step.name] = r?.shape ?? { type: "string", enum: ["true"] };
    if (r && !r.fromLiteral) out.dynamic.push({ where: "query", name: step.name, origin: r.origin ?? "unknown", shape: r.shape });
  }
}
