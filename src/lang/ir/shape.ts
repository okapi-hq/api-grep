import { staticText } from "../../resolve/parts.js";
import { unionOf } from "../../resolve/shape-utils.js";
import type { DynamicOrigin, DynamicPart, Shape } from "../../types.js";
import { evaluate } from "./evaluate.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "./model.js";
import { exprText } from "./model.js";
import { classField, lookup } from "./project.js";
import type { IrCtx } from "./raw.js";
import { classShape, constructedClass, typeShape } from "./types.js";
import { staticKey } from "./values.js";

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
      return { type: "string", enum: [e.v] };
    case "num":
      return Number.isFinite(e.v) ? { type: Number.isInteger(e.v) ? "integer" : "number", enum: [e.v] } : { type: "number" };
    case "bool":
      return { type: "boolean", enum: [e.v] };
    case "null":
      return { type: "null" };
    case "tmpl":
    case "concat":
    case "format": {
      const text = staticText(evaluate(e, fn, ctx));
      return text !== undefined ? { type: "string", enum: [text] } : { type: "string" };
    }
    default:
      return undefined;
  }
}

function originOf(s: Shape): string {
  return s.type === "dynamic" ? s.origin : s.type === "unknown" ? "unknown" : "type";
}

type Acc = { properties: Record<string, Shape>; required: string[]; dynamicKeys: boolean };

function mergeSpread(acc: Acc, spread: Shape): void {
  if (spread.type !== "object") {
    acc.dynamicKeys = true;
    return;
  }
  Object.assign(acc.properties, spread.properties);
  for (const r of spread.required) if (!acc.required.includes(r)) acc.required.push(r);
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
      mergeSpread(acc, r.shape);
      if (r.shape.type === "dynamic" || r.shape.type === "unknown") dynamic.push({ where: "body", name: `...${exprText(en.value).slice(0, 40)}`, origin: originOf(r.shape) });
      continue;
    }
    const key = staticKey(en.key, fn, ctx);
    if (key === undefined) {
      acc.dynamicKeys = true;
      continue;
    }
    const r = shapeOf(en.value, fn, ctx, depth + 1, dynamic);
    acc.properties[key] = r.shape;
    if (!(r.shape.type === "union" && r.shape.anyOf.some((s) => s.type === "null") && !r.fromLiteral)) acc.required.push(key);
    if (!r.fromLiteral) dynamic.push({ where: "body", name: key, origin: r.origin ?? originOf(r.shape) });
  }
  return { type: "object", properties: acc.properties, required: acc.required, ...(acc.dynamicKeys ? { dynamicKeys: true } : {}) };
}

function nameShape(e: Expr & { k: "name" }, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "value" && !b.assign.augmented) return shapeOf(b.assign.value, b.fn, ctx, depth + 1, dynamic);
  if (b.kind === "param") {
    const sub = ctx.subst?.get(b.param);
    if (sub) return shapeOf(sub.expr, sub.fn, ctx, depth + 1, dynamic);
    const typed = b.param.type ? typeShape(b.param.type, b.fn, ctx) : undefined;
    if (typed) return { shape: withHint(typed, e.name), fromLiteral: false, origin: "param" };
    return { shape: { type: "dynamic", origin: "param", hint: e.name.replace(/^\$/, "") }, fromLiteral: false, origin: "param" };
  }
  return { shape: { type: "dynamic", origin: "unknown", hint: e.name.replace(/^\$/, "") }, fromLiteral: false, origin: "unknown" };
}

function callShape(e: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number, dynamic: DynamicPart[]): ShapeResult {
  const name = e.fn.k === "attr" ? e.fn.name : e.fn.k === "name" ? e.fn.name : undefined;
  if (name && UNWRAP_METHODS.has(name) && e.fn.k === "attr") return shapeOf(e.fn.obj, fn, ctx, depth + 1, dynamic);
  if (name && UNWRAP_FUNCTIONS.has(name) && e.args[0] && !e.args[0].name) return shapeOf(e.args[0].value, fn, ctx, depth + 1, dynamic);
  if (name === "dict" && e.args.every((a) => a.name || a.spread === "dict")) {
    const entries: Entry[] = e.args.map((a) => (a.spread ? { value: a.value, spread: true } : { key: { k: "str", v: a.name! }, value: a.value }));
    return { shape: dictShape(entries, fn, ctx, depth, dynamic), fromLiteral: true };
  }
  const cls = constructedClass(e.fn, fn, ctx);
  const shape = cls ? classShape(cls, ctx) : undefined;
  if (shape) return { shape, fromLiteral: false, origin: "call" };
  return { shape: { type: "dynamic", origin: "call", hint: name }, fromLiteral: false, origin: "call" };
}

/** Shape of an arbitrary expression: literals first, then variables and arguments, then declared types. */
export function shapeOf(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0, dynamic: DynamicPart[] = []): ShapeResult {
  if (depth > MAX_DEPTH) return { shape: { type: "unknown" }, fromLiteral: false };
  const lit = literalShape(e, fn, ctx);
  if (lit) return { shape: lit, fromLiteral: true };
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
      return { shape: { type: "string", hint: e.name }, fromLiteral: false, origin: "env" };
    case "or":
    case "cond": {
      const [a, b] = e.k === "or" ? [e.left, e.right] : [e.then, e.else];
      const l = shapeOf(a, fn, ctx, depth + 1, dynamic);
      const r = shapeOf(b, fn, ctx, depth + 1, dynamic);
      return { shape: unionOf([l.shape, r.shape].filter((s) => s.type !== "null" || e.k === "cond")), fromLiteral: l.fromLiteral && r.fromLiteral, origin: l.origin ?? r.origin };
    }
    case "attr":
      if (e.obj.k === "this" && fn.cls) {
        const f = classField(fn.cls, e.name, ctx.idx)[0];
        if (f) return shapeOf(f.value, f.fn, ctx, depth + 1, dynamic);
      }
      return { shape: { type: "dynamic", origin: "unknown", hint: e.name }, fromLiteral: false, origin: "unknown" };
    default:
      return { shape: { type: "dynamic", origin: "unknown" }, fromLiteral: false, origin: "unknown" };
  }
}
