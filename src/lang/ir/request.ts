import { addHeader, type HeadersResult } from "../../resolve/header-names.js";
import { staticText } from "../../resolve/parts.js";
import { formStringShape, jsonToShape } from "../../resolve/shape-utils.js";
import type { BodyResult } from "../../resolve/body.js";
import type { AuthScheme, BodyEncoding, DynamicPart, Shape } from "../../types.js";
import { evaluate } from "./evaluate.js";
import type { OptionRole, Scoped } from "./language.js";
import type { Expr, FunctionDef } from "./model.js";
import type { IrCtx } from "./raw.js";
import { shapeOf } from "./shape.js";
import { dictOf, deref, staticKey } from "./values.js";

const ROLE_ENCODING: Partial<Record<OptionRole, BodyEncoding>> = { "body:json": "json", "body:form": "form", "body:multipart": "multipart", "body:raw": "raw" };

const calleeName = (e: Expr): string | undefined =>
  e.k === "call" ? (e.fn.k === "attr" ? e.fn.name : e.fn.k === "name" ? e.fn.name : e.fn.k === "qname" ? e.fn.path[e.fn.path.length - 1] : undefined) : undefined;

/** `json.dumps(x)` / `urlencode(x)` / `json_encode($x)`: the serialized value and the encoding it implies. */
function unwrapSerializer(s: Scoped, ctx: IrCtx, depth = 0): { inner: Scoped; encoding?: BodyEncoding } {
  const d = deref(s.expr, s.fn, ctx);
  // `json.dumps(x).encode("utf-8")`: the bytes of the serialized value
  if (d.expr.k === "call" && d.expr.fn.k === "attr" && ctx.idx.lang.passthrough.methods.has(d.expr.fn.name) && depth < 3) {
    return unwrapSerializer({ expr: d.expr.fn.obj, fn: d.fn }, ctx, depth + 1);
  }
  const name = d.expr.k === "call" ? calleeName(d.expr) : undefined;
  const qualified = d.expr.k === "call" && d.expr.fn.k === "attr" && d.expr.fn.obj.k === "name" ? `${d.expr.fn.obj.name}.${d.expr.fn.name}` : name;
  const enc = qualified ? (ctx.idx.lang.serializers[qualified] ?? (name ? ctx.idx.lang.serializers[name] : undefined)) : undefined;
  const arg = d.expr.k === "call" ? d.expr.args[0] : undefined;
  if (enc && arg && !arg.name) return { inner: { expr: arg.value, fn: d.fn }, encoding: enc };
  return { inner: d };
}

function stringBody(expr: Expr, fn: FunctionDef, ctx: IrCtx): Pick<BodyResult, "shape" | "encoding"> | undefined {
  if (expr.k !== "str" && expr.k !== "tmpl" && expr.k !== "concat" && expr.k !== "format") return undefined;
  const parts = evaluate(expr, fn, ctx);
  const text = staticText(parts);
  if (text !== undefined) {
    try {
      return { shape: jsonToShape(JSON.parse(text)), encoding: "json" };
    } catch {
      // not JSON: a form string or raw text
    }
  }
  const form = formStringShape(parts);
  return form ? { shape: form, encoding: "form" } : { shape: { type: "string" }, encoding: "raw" };
}

/** Request body: shape, encoding (from the option that carries it, a serializer, or the value) and dynamic parts. */
export function resolveIrBody(body: Scoped | undefined, role: OptionRole | undefined, fallback: BodyEncoding, ctx: IrCtx): BodyResult {
  if (!body) return { encoding: "none", dynamic: [], fromLiteral: false };
  const { inner, encoding: serialized } = unwrapSerializer(body, ctx);
  // `json=None` (often a wrapper's default): no body is sent
  if (inner.expr.k === "null") return { encoding: "none", dynamic: [], fromLiteral: false };
  const roleEncoding = role ? ROLE_ENCODING[role] : undefined;
  const asString = stringBody(inner.expr, inner.fn, ctx);
  if (asString) {
    return { ...asString, encoding: roleEncoding === "multipart" ? "multipart" : asString.encoding, dynamic: [], fromLiteral: true };
  }
  const dynamic: DynamicPart[] = [];
  const r = shapeOf(inner.expr, inner.fn, ctx, 0, dynamic);
  if (r.shape.type === "dynamic" || r.shape.type === "unknown") dynamic.push({ where: "body", name: "body", origin: r.shape.type === "dynamic" ? r.shape.origin : "unknown" });
  const encoding = serialized ?? roleEncoding ?? fallback;
  const fromType = r.shape.type === "object" ? r.shape.fromType : undefined;
  return { shape: r.shape, encoding, dynamic, fromType, fromLiteral: r.fromLiteral };
}

export interface IrQuery {
  names: string[];
  shape: Record<string, Shape>;
  dynamic: DynamicPart[];
}

function addProps(out: IrQuery, s: Shape, origin: string): void {
  if (s.type !== "object") return;
  for (const [k, v] of Object.entries(s.properties)) {
    if (!out.names.includes(k)) out.names.push(k);
    out.shape[k] = v;
    out.dynamic.push({ where: "query", name: k, origin, shape: v });
  }
}

/** Query parameters from a `params=` dict: names, per-key shapes and the values that are not literals. */
export function resolveIrQuery(query: Scoped | undefined, ctx: IrCtx): IrQuery {
  const out: IrQuery = { names: [], shape: {}, dynamic: [] };
  if (!query) return out;
  const dict = dictOf(query.expr, query.fn, ctx);
  if (!dict) {
    const r = shapeOf(query.expr, query.fn, ctx, 1);
    addProps(out, r.shape, r.origin ?? "unknown");
    return out;
  }
  for (const en of dict.entries) {
    const r = shapeOf(en.value, dict.fn, ctx, 1);
    if (en.spread) {
      addProps(out, r.shape, r.origin ?? "unknown");
      continue;
    }
    const key = staticKey(en.key, dict.fn, ctx);
    if (key === undefined || en.value.k === "null") continue;
    if (!out.names.includes(key)) out.names.push(key);
    out.shape[key] = r.shape;
    if (!r.fromLiteral) out.dynamic.push({ where: "query", name: key, origin: r.origin ?? "unknown", shape: r.shape });
  }
  return out;
}

function collectHeaders(s: Scoped, ctx: IrCtx, out: HeadersResult, depth: number): void {
  const dict = dictOf(s.expr, s.fn, ctx);
  if (!dict) {
    out.known = false;
    return;
  }
  for (const en of dict.entries) {
    if (en.spread) {
      if (depth < 3) collectHeaders({ expr: en.value, fn: dict.fn }, ctx, out, depth + 1);
      else out.known = false;
      continue;
    }
    const key = staticKey(en.key, dict.fn, ctx);
    if (key === undefined) {
      out.known = false;
      continue;
    }
    addHeader(out, key, evaluate(en.value, dict.fn, ctx));
  }
}

/** Header names (lower-cased), literal values that are not credentials, and the auth scheme they imply. */
export function resolveIrHeaders(sources: Scoped[], ctx: IrCtx): HeadersResult {
  const out: HeadersResult = { names: [], values: {}, authScheme: "none", known: true };
  for (const s of sources) collectHeaders(s, ctx, out, 0);
  if (!out.known && out.authScheme === "none") out.authScheme = "unknown";
  return out;
}

/** `auth=("user", "pass")`, `auth=HTTPBasicAuth(...)`, `'auth' => [$user, $pass]`: the scheme an auth option implies. */
export function authOfOption(s: Scoped, ctx: IrCtx): AuthScheme {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k === "list" && d.expr.items.length >= 2) return "basic";
  if (d.expr.k === "dict" && d.expr.entries.length >= 2 && d.expr.entries.every((e) => !e.key)) return "basic";
  const name = calleeName(d.expr) ?? "";
  if (/basic/i.test(name)) return "basic";
  if (/bearer|token/i.test(name)) return "bearer";
  if (/digest/i.test(name)) return "basic";
  return "unknown";
}
