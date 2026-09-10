import { Node, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { propertyKey, toObjectLiteral } from "../detect/options.js";
import type { AuthScheme, EvalCtx } from "../types.js";
import { evaluate } from "./evaluate.js";
import { typeToShape } from "./type-shape.js";

export interface HeadersResult {
  names: string[];
  authScheme: AuthScheme;
  known: boolean;
}

const APIKEY_HEADERS = new Set(["x-api-key", "api-key", "apikey", "x-auth-token", "x-token", "api_key", "x-access-token", "x-goog-api-key", "anthropic-api-key"]);

function schemeFromAuthValue(value: Expression | undefined, ctx: EvalCtx): AuthScheme {
  if (!value) return "unknown";
  const first = evaluate(value, ctx)[0];
  const head = first?.kind === "static" ? first.text.trim().toLowerCase() : "";
  if (head.startsWith("bearer")) return "bearer";
  if (head.startsWith("basic")) return "basic";
  if (head.startsWith("token")) return "apikey";
  return "unknown";
}

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
    const value = Node.isPropertyAssignment(member) ? member.getInitializer() : Node.isShorthandPropertyAssignment(member) ? member.getNameNode() : undefined;
    pushName(out, key, value, ctx);
  }
}

function pushName(out: HeadersResult, key: string, value: Expression | undefined, ctx: EvalCtx): void {
  const lower = key.toLowerCase();
  if (!out.names.includes(lower)) out.names.push(lower);
  if (lower === "authorization") {
    const s = schemeFromAuthValue(value, ctx);
    if (out.authScheme === "none" || out.authScheme === "unknown") out.authScheme = s;
  } else if (APIKEY_HEADERS.has(lower)) out.authScheme = "apikey";
}

/** Header names (lower-cased) and auth scheme from a headers expression. Values are never kept. */
export function resolveHeaders(expr: Expression | undefined, ctx: EvalCtx = {}): HeadersResult {
  const out: HeadersResult = { names: [], authScheme: "none", known: true };
  if (!expr) return out;
  let u = unwrap(expr);
  if (Node.isNewExpression(u) && u.getExpression().getText() === "Headers") {
    const arg = u.getArguments()[0] as Expression | undefined;
    if (!arg) return { names: [], authScheme: "unknown", known: false };
    u = arg;
  }
  collect(u, ctx, out, 0);
  if (!out.known && out.authScheme === "none") out.authScheme = "unknown";
  return out;
}
