import type { Shape } from "../types.js";
import { byName, credentialPlaceholder, looksBoolean } from "./names.js";
import type { Rng } from "./random.js";

export type Variant = "minimal" | "full" | "alt";

export interface SynthCtx {
  rng: Rng;
  variant: Variant;
}

const MAX_DEPTH = 6;
const MAX_PROPS = 40;

function pickEnum(values: (string | number | boolean)[], variant: Variant): string | number | boolean {
  if (values.length === 0) return "";
  return values[variant === "alt" ? 1 % values.length : 0]!;
}

/** The identifier that flowed into a property usually says more than the key: `{ username: email }`. */
function named(key: string, hint: string | undefined, kind: "string" | "number", ctx: SynthCtx): string | number | undefined {
  const fromHint = hint && hint !== key ? byName(hint, kind, ctx.rng) : undefined;
  return fromHint ?? byName(key, kind, ctx.rng);
}

function stringValue(key: string, hint: string | undefined, ctx: SynthCtx): string {
  const v = named(key, hint, "string", ctx);
  if (v !== undefined) return String(v);
  return ctx.rng.words(2);
}

function numberValue(key: string, hint: string | undefined, integer: boolean, ctx: SynthCtx): number {
  const v = named(key, hint, "number", ctx);
  if (typeof v === "number") return integer ? Math.round(v) : v;
  return integer || /count|num|index|size|length|level|order|position|rank|priority/i.test(key) ? ctx.rng.int(1, 999) : ctx.rng.int(1, 99);
}

function unionBranch(shapes: Shape[], ctx: SynthCtx): Shape | undefined {
  const nonNull = shapes.filter((s) => s.type !== "null");
  if (nonNull.length === 0) return shapes[0];
  const idx = ctx.variant === "alt" ? 1 % nonNull.length : 0;
  return nonNull[idx];
}

function objectValue(shape: Extract<Shape, { type: "object" }>, ctx: SynthCtx, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(shape.properties);
  const wanted = ctx.variant === "minimal" && shape.required.length > 0 ? keys.filter((k) => shape.required.includes(k)) : keys;
  for (const k of wanted.slice(0, MAX_PROPS)) out[k] = synth(shape.properties[k]!, k, ctx, depth + 1);
  return out;
}

/** Placeholder value for a shape the checker could not describe; name heuristics first, then random words. */
function opaqueValue(key: string, hint: string | undefined, ctx: SynthCtx): unknown {
  const cred = credentialPlaceholder(key) ?? (hint ? credentialPlaceholder(hint) : undefined);
  if (cred) return cred;
  if (hint && /^(Buffer|Blob|File|ReadableStream|Readable|ArrayBuffer|SharedArrayBuffer|DataView|ArrayBufferView|\w+Array)$/.test(hint)) return "<binary>";
  if (looksBoolean(key)) return ctx.variant !== "alt";
  const byKey = byName(key, "string", ctx.rng) ?? (hint ? byName(hint, "string", ctx.rng) : undefined);
  if (byKey !== undefined) return byKey;
  const asNumber = byName(key, "number", ctx.rng);
  if (asNumber !== undefined) return asNumber;
  return ctx.rng.words(2);
}

/** Produces a concrete value for `shape`, using `key` (property or parameter name) to pick realistic content. */
export function synth(shape: Shape, key: string, ctx: SynthCtx, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  switch (shape.type) {
    case "string": {
      if (shape.enum && shape.enum.length > 0) return pickEnum(shape.enum, ctx.variant);
      return stringValue(key, shape.hint, ctx);
    }
    case "integer":
    case "number": {
      if (shape.enum && shape.enum.length > 0) return pickEnum(shape.enum, ctx.variant);
      return numberValue(key, shape.hint, shape.type === "integer", ctx);
    }
    case "boolean": {
      if (shape.enum && shape.enum.length > 0) return pickEnum(shape.enum, ctx.variant);
      return ctx.variant !== "alt";
    }
    case "null":
      return null;
    case "array": {
      const n = ctx.variant === "full" ? 2 : 1;
      const itemKey = key.endsWith("s") ? key.slice(0, -1) : key;
      return Array.from({ length: n }, () => synth(shape.items, itemKey, ctx, depth + 1));
    }
    case "object":
      return objectValue(shape, ctx, depth);
    case "union": {
      const branch = unionBranch(shape.anyOf, ctx);
      return branch ? synth(branch, key, ctx, depth + 1) : null;
    }
    case "dynamic":
      return opaqueValue(key, shape.hint, ctx);
    case "unknown":
      return opaqueValue(key, undefined, ctx);
  }
}

/** True when a second example could legitimately differ: enums with alternatives, unions, booleans, optional props. */
export function hasAlternatives(shape: Shape | undefined, depth = 0): boolean {
  if (!shape || depth > MAX_DEPTH) return false;
  switch (shape.type) {
    case "string":
    case "integer":
    case "number":
      return (shape.enum?.length ?? 0) > 1;
    case "boolean":
      return (shape.enum?.length ?? 0) !== 1;
    case "array":
      return hasAlternatives(shape.items, depth + 1);
    case "object":
      return Object.values(shape.properties).some((s) => hasAlternatives(s, depth + 1));
    case "union":
      return shape.anyOf.filter((s) => s.type !== "null").length > 1 || shape.anyOf.some((s) => hasAlternatives(s, depth + 1));
    default:
      return false;
  }
}

/** True when a "full" example adds something over the minimal one (optional properties or arrays). */
export function hasOptional(shape: Shape | undefined, depth = 0): boolean {
  if (!shape || depth > MAX_DEPTH) return false;
  if (shape.type === "object") {
    const keys = Object.keys(shape.properties);
    return (shape.required.length > 0 && keys.some((k) => !shape.required.includes(k))) || keys.some((k) => hasOptional(shape.properties[k], depth + 1));
  }
  if (shape.type === "array") return hasOptional(shape.items, depth + 1);
  if (shape.type === "union") return shape.anyOf.some((s) => hasOptional(s, depth + 1));
  return false;
}
