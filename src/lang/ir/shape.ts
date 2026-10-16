import { isSafeKey } from "../../record-keys.js";
import { staticText } from "../../resolve/parts.js";
import { paramValues } from "../../resolve/param-shape.js";
import { alternativesOf, unionOf } from "../../resolve/shape-utils.js";
import { asDefault } from "../../model/value-sources.js";
import { stringShapeOf } from "../../resolve/string-template.js";
import { VALUE_SOURCES, type DynamicOrigin, type DynamicPart, type Shape } from "../../types.js";
import { calleeChain } from "./chain.js";
import { evaluate } from "./evaluate.js";
import { fluentMap } from "./fluent.js";
import { paramValue } from "./injected.js";
import type { CallExpr, Entry, Expr, FunctionDef, Param } from "./model.js";
import { callerCtx, paramSources } from "./param-values.js";
import { argFor, exprText } from "./model.js";
import { classField, lookup } from "./project.js";
import { withSubst, type IrCtx, type Subst } from "./raw.js";
import { classShape, constructedClass, typeShape } from "./types.js";
import { recordField, type RecordField } from "./object-fields.js";
import { constantAt, dictRead, knownConstant, staticKey } from "./values.js";

/** Assignments of one field read for its shape: a bound on hostile input. */
const MAX_FIELD_VALUES = 8;
const MAX_DEPTH = 6;
const GENERIC_HINT = /^(input|data|value|body|params|opts|options|args|kwargs|payload|req|res|result|item|obj|e|x|v|self|this)$/;
/** Calls that hand back the object they are given (`model.model_dump()`, `asdict(x)`, `dict(x)`). */
const UNWRAP_METHODS = new Set(["model_dump", "dict", "to_dict", "toArray", "jsonSerialize", "copy"]);
const UNWRAP_FUNCTIONS = new Set(["asdict", "dict", "jsonable_encoder", "deepcopy"]);

export interface ShapeResult {
  shape: Shape;
  fromLiteral: boolean;
  origin?: DynamicOrigin;
}


/** Scalars keep the source identifier as a hint (`{"username": email}` is an email) unless the name is generic. */
function withHint(shape: Shape, hint: string | undefined): Shape {
  if (shape.type !== "string" && shape.type !== "number" && shape.type !== "integer" && shape.type !== "boolean") return shape;
  const h = hint?.replace(/^\$/, "");
  if (!h || !/^[A-Za-z_]\w*$/.test(h) || GENERIC_HINT.test(h)) return shape;
  return { ...shape, hint: h };
}

function literalShape(e: Expr, fn: FunctionDef, ctx: IrCtx): Shape | undefined {
  switch (e.k) {
    case "str":
      return { type: "string", enum: [e.v], ...(e.src ? { [VALUE_SOURCES]: new Map([[e.v, e.src]]) } : {}) };
    case "num":
      return Number.isFinite(e.v) ? { type: Number.isInteger(e.v) ? "integer" : "number", enum: [e.v] } : { type: "number" };
    case "bool":
      return { type: "boolean", enum: [e.v] };
    case "null":
      return { type: "null" };
    case "tmpl":
    case "concat":
    case "format":
      return stringShapeOf(evaluate(e, fn, ctx));
    case "attr": {
      // a library constant the language lists (`openai.GPT4o`): a value written in the code, as a literal is
      const constant = knownConstant(e, ctx);
      return constant !== undefined ? { type: "string", enum: [constant] } : undefined;
    }
    default:
      return undefined;
  }
}

function originOf(s: Shape): string {
  return s.type === "dynamic" ? s.origin : s.type === "unknown" ? "unknown" : "type";
}

type Acc = { properties: Record<string, Shape>; required: string[]; dynamicKeys: boolean };

/** A spread made on some paths only (`optional`) adds its keys without requiring them. */
function mergeSpread(acc: Acc, spread: Shape, optional = false): void {
  if (spread.type !== "object") {
    acc.dynamicKeys = true;
    return;
  }
  Object.assign(acc.properties, spread.properties);
  if (!optional) for (const r of spread.required) if (!acc.required.includes(r)) acc.required.push(r);
  if (spread.dynamicKeys) acc.dynamicKeys = true;
}

/** A dict literal (or PHP associative array) as an object shape; a list of positional items is an array. */
export function dictShape(entries: Entry[], fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): Shape {
  // like the TypeScript front end, values nested in arrays are not listed as dynamic parts
  if (entries.length > 0 && entries.every((en) => !en.key && !en.spread)) {
    return { type: "array", items: unionOf(entries.map((en) => shapeOf(en.value, fn, ctx, depth + 1).shape)) };
  }
  const acc: Acc = { properties: {}, required: [], dynamicKeys: false };
  for (const en of entries) {
    if (en.spread) {
      const r = shapeOf(en.value, fn, ctx, depth + 1, dynamic);
      mergeSpread(acc, r.shape, en.optional);
      if (r.shape.type === "dynamic" || r.shape.type === "unknown") dynamic.push({ where: "body", name: `...${exprText(en.value).slice(0, 40)}`, origin: originOf(r.shape) });
      continue;
    }
    const key = staticKey(en.key, fn, ctx);
    if (key === undefined || !isSafeKey(key)) {
      acc.dynamicKeys = true;
      continue;
    }
    const r = shapeOf(en.value, fn, ctx, depth + 1, dynamic);
    acc.properties[key] = r.shape;
    const nullable = r.shape.type === "union" && r.shape.anyOf.some((s) => s.type === "null") && !r.fromLiteral;
    if (!nullable && !en.optional && !acc.required.includes(key)) acc.required.push(key);
    if (!r.fromLiteral) dynamic.push({ where: "body", name: key, origin: r.origin ?? originOf(r.shape) });
  }
  return { type: "object", properties: acc.properties, required: acc.required, ...(acc.dynamicKeys ? { dynamicKeys: true } : {}) };
}

function nameShape(e: Expr & { k: "name" }, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "value" && !b.assign.augmented) return shapeOf(b.assign.value, b.fn, ctx, depth + 1, dynamic);
  // a library constant imported by name (Rust `use openai_api_rs::v1::common::GPT4_O`), as `knownConstant` reads a path
  const imported = b.kind === "external" ? constantAt(b.path, ctx) : undefined;
  if (imported !== undefined) return { shape: { type: "string", enum: [imported] }, fromLiteral: true };
  if (b.kind === "param") {
    const sub = paramValue(b.param, b.fn, ctx);
    if (sub) return shapeOf(sub.expr, sub.fn, ctx, depth + 1, dynamic);
    const typed = b.param.type ? typeShape(b.param.type, b.fn, ctx) : undefined;
    const unread: ShapeResult = typed
      ? { shape: withHint(typed, e.name), fromLiteral: false, origin: "param" }
      : { shape: { type: "dynamic", origin: "param", hint: e.name.replace(/^\$/, "") }, fromLiteral: false, origin: "param" };
    return paramShape(b.param, b.fn, ctx, depth, unread);
  }
  return { shape: { type: "dynamic", origin: "unknown", hint: e.name.replace(/^\$/, "") }, fromLiteral: false, origin: "unknown" };
}

/** A parameter nobody substituted: the values its callers pass and its default, as alternatives (#39). */
function paramShape(p: Param, fn: FunctionDef, ctx: IrCtx, depth: number, unread: ShapeResult): ShapeResult {
  const found = paramSources(p, fn, ctx);
  if (!found) return unread;
  // the callers' own dynamic parts belong to them, not to this request
  const results = found.sources.map((s) => {
    const r = shapeOf(s.expr, s.fn, callerCtx(ctx), depth + 1, []);
    return s.expr === p.default ? { ...r, shape: asDefault(r.shape) } : r;
  });
  return paramValues(results, found.unread, unread);
}

function callShape(e: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  // a call that stands for a value the language reads directly (a JVM builder's fields)
  const resolved = ctx.idx.lang.resolveCall?.(e, fn, ctx);
  if (resolved?.expr.k === "dict") return shapeOf(resolved.expr, resolved.fn, ctx, depth + 1, dynamic);
  const name = e.fn.k === "attr" ? e.fn.name : e.fn.k === "name" ? e.fn.name : undefined;
  if (name && UNWRAP_METHODS.has(name) && e.fn.k === "attr") return shapeOf(e.fn.obj, fn, ctx, depth + 1, dynamic);
  // `.strip()`, `.lower()`, `str(x)`: the same value
  if (name && e.fn.k === "attr" && ctx.idx.lang.passthrough.methods.has(name)) return shapeOf(e.fn.obj, fn, ctx, depth + 1, dynamic);
  if (name && e.fn.k === "name" && ctx.idx.lang.passthrough.functions.has(name) && e.args[0] && !e.args[0].name) return shapeOf(e.args[0].value, fn, ctx, depth + 1, dynamic);
  if (name && UNWRAP_FUNCTIONS.has(name) && e.args[0] && !e.args[0].name) return shapeOf(e.args[0].value, fn, ctx, depth + 1, dynamic);
  if (name === "dict" && e.args.every((a) => a.name || a.spread === "dict")) {
    const entries: Entry[] = e.args.map((a) => (a.spread ? { value: a.value, spread: true } : { key: { k: "str", v: a.name! }, value: a.value }));
    return { shape: dictShape(entries, fn, ctx, depth, dynamic), fromLiteral: true };
  }
  const cls = constructedClass(e.fn, fn, ctx);
  const shape = cls ? classShape(cls, ctx) : undefined;
  if (shape) return { shape, fromLiteral: false, origin: "call" };
  return returnsShape(e, fn, ctx, depth) ?? dictReadShape(e, fn, ctx, depth, dynamic) ?? { shape: { type: "dynamic", origin: "call", hint: name }, fromLiteral: false, origin: "call" };
}

/** `cfg["model"]`, `opts.get("model", "gpt-4o")`: the entry the dict holds, else the read's default beside the unread value. */
function dictReadShape(e: Expr, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult | undefined {
  const read = dictRead(e, fn, ctx);
  if (!read) return undefined;
  if (read.entry) return shapeOf(read.entry.expr, read.entry.fn, ctx, depth + 1, dynamic);
  const origin = e.k === "call" ? "call" : "unknown";
  const fallback = read.fallback ? shapeOf(read.fallback, fn, ctx, depth + 1, dynamic).shape : undefined;
  const unread: ShapeResult = { shape: { type: "dynamic", origin, hint: read.key }, fromLiteral: false, origin };
  if (!fallback || fallback.type === "null") return read.known ? undefined : unread;
  return { shape: read.known ? asDefault(fallback) : alternativesOf([unread.shape, asDefault(fallback)]), fromLiteral: false, origin };
}

/** What a function of the project returns (`model=get_model()`): every return's shape, its arguments substituted. */
function returnsShape(call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): ShapeResult | undefined {
  const target = calleeChain(call, fn, ctx);
  if (target.root.kind !== "function" || target.segs.length > 0 || target.root.fn.returns.length === 0) return undefined;
  const helper = target.root.fn;
  const subst: Subst = new Map();
  for (const p of helper.params) {
    const arg = argFor(call, p);
    // a parameter this call leaves out is its default here, not what other callers pass
    if (arg) subst.set(p, { expr: arg.value, fn });
    else if (p.default && p.kind === "normal") subst.set(p, { expr: p.default, fn: helper });
  }
  // the returns' own dynamic parts belong to the function, not to this request
  const results = helper.returns.map((r) => shapeOf(r, helper, withSubst(ctx, subst), depth + 1, []));
  if (results.every((r) => r.shape.type === "dynamic" || r.shape.type === "unknown")) return undefined;
  return { shape: alternativesOf(results.map((r) => r.shape)), fromLiteral: false, origin: "call" };
}

/** An env var read: a string from that variable, its literal default (`os.getenv("MODEL", "gpt-4o")`) as the value. */
function envString(name: string, fallback: string | undefined): ShapeResult {
  return { shape: { type: "string", ...(fallback ? { enum: [fallback] } : {}), hint: name, env: name }, fromLiteral: false, origin: "env" };
}

function envShape(name: string, fallback: Expr | undefined, fn: FunctionDef, ctx: IrCtx): ShapeResult {
  return envString(name, fallback ? staticText(evaluate(fallback, fn, ctx)) : undefined);
}

/**
 * `settings.model`, `config.MODEL`: a field of an object the code builds (`settings = Settings()`, its class default),
 * else what the evaluator reads (a module constant, an env var).
 */
function attrShape(e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const record = recordField(e, fn, ctx);
  if (record) return recordShape(record, e.name, ctx, depth, dynamic);
  // `args.model`: a command line's value, else the parser's default
  const lib = ctx.idx.lang.attrDefault?.(e, fn, ctx);
  const dflt = lib ? shapeOf(lib.expr, lib.fn, ctx, depth + 1, dynamic).shape : undefined;
  if (dflt && dflt.type !== "null") return { shape: alternativesOf([{ type: "dynamic", origin: "unknown", hint: e.name }, asDefault(dflt)]), fromLiteral: false, origin: "unknown" };
  const parts = evaluate(e, fn, ctx, depth);
  const only = parts.length === 1 ? parts[0]! : undefined;
  if (only?.kind === "env") return envString(only.name, only.fallback);
  const text = staticText(parts);
  if (text) return { shape: { type: "string", enum: [text] }, fromLiteral: false, origin: "unknown" };
  return { shape: { type: "dynamic", origin: "unknown", hint: e.name }, fromLiteral: false, origin: "unknown" };
}

/** A record's field: its value (a class default is a default), read from the env var a settings class names. */
function recordShape(f: RecordField, name: string, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const r = f.value ? shapeOf(f.value.expr, f.value.fn, f.value.ctx ?? ctx, depth + 1, dynamic) : undefined;
  const shape = r && f.isDefault ? asDefault(r.shape) : r?.shape;
  if (!f.env) return { shape: shape!, fromLiteral: false, origin: r?.origin ?? "unknown" };
  const env: Shape = { type: "string", hint: name, env: f.env };
  // `model: str = "gpt-4o"` in a settings class: the env var's default
  if (shape?.type === "string" && shape.enum?.length && !shape.env) return { shape: { ...shape, env: f.env }, fromLiteral: false, origin: "env" };
  return { shape: shape && shape.type !== "null" ? alternativesOf([env, shape]) : env, fromLiteral: false, origin: "env" };
}

/** Values of a field set in several places (`self.model = model or "a"` in one branch, `"b"` in another): any of them. */
function fieldShape(fields: { value: Expr; fn: FunctionDef }[], ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const each = fields.slice(0, MAX_FIELD_VALUES).map((f) => shapeOf(f.value, f.fn, ctx, depth + 1, dynamic));
  // `self.x = None` before it is set: not one of the values a request sends
  const set = each.filter((r) => r.shape.type !== "null");
  const kept = set.length > 0 ? set : each;
  if (kept.length === 1) return kept[0]!;
  return { shape: unionOf(kept.map((r) => r.shape)), fromLiteral: kept.every((r) => r.fromLiteral), origin: kept.find((r) => r.origin)?.origin };
}

/** Shape of an arbitrary expression: literals first, then variables and arguments, then declared types. */
export function shapeOf(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0, dynamic: DynamicPart[] = []): ShapeResult {
  if (depth > MAX_DEPTH) return { shape: { type: "unknown" }, fromLiteral: false };
  const lit = literalShape(e, fn, ctx);
  if (lit) return { shape: lit, fromLiteral: true };
  const built = fluentMap(e, fn, ctx);
  if (built) return shapeOf(built.expr, built.fn, ctx, depth + 1, dynamic);
  switch (e.k) {
    case "dict":
      return { shape: dictShape(e.entries, fn, ctx, depth, dynamic), fromLiteral: true };
    case "list":
      return { shape: { type: "array", items: unionOf(e.items.map((i) => shapeOf(i, fn, ctx, depth + 1).shape)) }, fromLiteral: true };
    case "name":
      return nameShape(e, fn, ctx, depth, dynamic);
    case "call":
      return callShape(e, fn, ctx, depth, dynamic);
    case "env":
      return envShape(e.name, e.fallback, fn, ctx);
    case "scoped":
      return shapeOf(e.expr, e.fn, ctx, depth + 1, dynamic);
    case "or":
    case "cond": {
      const [a, b] = e.k === "or" ? [e.left, e.right] : [e.then, e.else];
      const l = shapeOf(a, fn, ctx, depth + 1, dynamic);
      const r = shapeOf(b, fn, ctx, depth + 1, dynamic);
      // `model or "gpt-4o"`: what the right side gives is a fallback
      const right = e.k === "or" && !l.fromLiteral ? asDefault(r.shape) : r.shape;
      return { shape: alternativesOf([l.shape, right].filter((s) => s.type !== "null" || e.k === "cond")), fromLiteral: l.fromLiteral && r.fromLiteral, origin: l.origin ?? r.origin };
    }
    case "index":
      return dictReadShape(e, fn, ctx, depth, dynamic) ?? { shape: { type: "dynamic", origin: "unknown" }, fromLiteral: false, origin: "unknown" };
    case "attr":
      if (e.obj.k === "this" && fn.cls) {
        const fields = classField(fn.cls, e.name, ctx.idx);
        if (fields.length > 0) return fieldShape(fields, ctx, depth, dynamic);
      }
      return attrShape(e, fn, ctx, depth, dynamic);
    default:
      return { shape: { type: "dynamic", origin: "unknown" }, fromLiteral: false, origin: "unknown" };
  }
}
