import { isSafeKey } from "../record-keys.js";
import { mergedSources } from "../model/value-sources.js";
import { VALUE_SOURCES, type DynamicPart, type Part, type Shape } from "../types.js";
import { partsToTemplate } from "./parts.js";
import { dedupe, mergeLiterals } from "./type-shape.js";

export function unionOf(shapes: Shape[]): Shape {
  const items = dedupe(shapes);
  if (items.length === 0) return { type: "unknown" };
  if (items.length === 1) return items[0]!;
  return mergeLiterals(items) ?? { type: "union", anyOf: items };
}

/** A string whose values the code tells: literals, or an env var. */
const knownString = (s: Shape): boolean => s.type === "string" && (!!s.enum?.length || !!s.env);

/**
 * The values either side of a fallback or a condition can take (`x or "gpt-4o"`, `os.getenv("M") or "gpt-4o"`):
 * unlike `unionOf`, strings merge only when each is literals (`"a" if x else "b"`); a string with no known value (a typed
 * parameter) or an env var's does not swallow the literals beside it.
 */
export function alternativesOf(shapes: Shape[]): Shape {
  const members = shapes.flatMap((s) => (s.type === "union" ? s.anyOf : [s]));
  const strings = members.filter((s) => s.type === "string");
  const others = members.filter((s) => s.type !== "string");
  if (strings.length >= 2 && strings.every((s) => s.type === "string" && s.enum?.length && !s.env)) {
    // every value of every side (a declared `"a" | "b"` gives two: `unionOf` would keep the type only)
    const values = [...new Set(strings.flatMap((s) => (s.type === "string" ? (s.enum ?? []) : [])))];
    const sources = mergedSources(strings, values);
    const merged: Shape = { type: "string", enum: values, ...(sources ? { [VALUE_SOURCES]: sources } : {}) };
    return others.length > 0 ? unionOf([merged, ...others]) : merged;
  }
  if (strings.length < 2 || !strings.some(knownString)) return unionOf(shapes);
  const unknown = strings.find((s) => !knownString(s));
  return { type: "union", anyOf: dedupe([...strings.filter(knownString), ...(unknown ? [unknown] : []), ...others]) };
}

const FORM_PAIR_RE = /^[\w.\-[\]]+=/;

/** `\`a=${x}&b=1\`` style string bodies become form shapes: keys are static, values keep their part's shape. */
export function formStringShape(parts: Part[]): Shape | undefined {
  const template = partsToTemplate(parts);
  if (!FORM_PAIR_RE.test(template) || /\s/.test(template.split("&")[0]!.split("=")[0]!)) return undefined;
  const properties: Record<string, Shape> = {};
  const names = new Map(parts.filter((p): p is Extract<Part, { kind: "dynamic" }> => p.kind === "dynamic").map((p) => [p.name, p.shape]));
  for (const pair of template.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0 || pair.slice(0, eq).includes("{")) return undefined;
    const key = pair.slice(0, eq);
    if (!isSafeKey(key)) continue;
    const value = pair.slice(eq + 1);
    const m = /^\{([^}]+)\}$/.exec(value);
    const dynShape = m ? names.get(m[1]!) : undefined;
    properties[key] = value.includes("{") ? (dynShape && dynShape.type !== "object" ? dynShape : { type: "string", hint: m?.[1] }) : { type: "string", enum: [value] };
  }
  return { type: "object", properties, required: Object.keys(properties) };
}

/** A JSON value parsed from a literal string body, as a shape whose values are single-value enums. */
export function jsonToShape(v: unknown): Shape {
  if (v === null) return { type: "null" };
  if (typeof v === "string") return { type: "string", enum: [v] };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number", enum: [v] };
  if (typeof v === "boolean") return { type: "boolean", enum: [v] };
  if (Array.isArray(v)) return { type: "array", items: unionOf(v.map(jsonToShape)) };
  const o = v as Record<string, unknown>;
  const entries = Object.entries(o).filter(([k]) => isSafeKey(k));
  return { type: "object", properties: Object.fromEntries(entries.map(([k, x]) => [k, jsonToShape(x)])), required: entries.map(([k]) => k) };
}

/** Whether some object of the shape, at any depth, has the key. */
function namesKey(s: Shape, key: string, depth = 0): boolean {
  if (depth > 8) return false;
  if (s.type === "object") return Object.hasOwn(s.properties, key) || Object.values(s.properties).some((v) => namesKey(v, key, depth + 1));
  if (s.type === "array") return namesKey(s.items, key, depth + 1);
  return s.type === "union" && s.anyOf.some((m) => namesKey(m, key, depth + 1));
}

/**
 * An object body without the keys an SDK keeps for itself (`bodyOmit`), nor the dynamic parts named after them that no
 * key left in the body names; any other body as it is.
 */
export function omitBodyKeys(body: { shape?: Shape; dynamic: DynamicPart[] }, keys: string[] | undefined): void {
  const shape = body.shape;
  if (shape?.type !== "object" || !keys?.length) return;
  const properties = Object.fromEntries(Object.entries(shape.properties).filter(([k]) => !keys.includes(k)));
  const kept: Shape = { ...shape, properties, required: shape.required.filter((k) => k in properties) };
  body.shape = kept;
  body.dynamic = body.dynamic.filter((d) => d.where !== "body" || !keys.includes(d.name) || namesKey(kept, d.name));
}

/**
 * A body an SDK sends under a key of its own (`bodyWrap`): `{ product: fields }` for `product.create(fields)`; a dotted
 * key nests it (`fulfillment_order.message` for `fulfillmentOrder.close(id, message)`).
 */
export function wrapShape(shape: Shape | undefined, key: string | undefined): Shape | undefined {
  const keys = key?.split(".") ?? [];
  if (!shape || keys.length === 0 || !keys.every(isSafeKey)) return shape;
  return keys.reduceRight<Shape>((inner, k) => ({ type: "object", properties: { [k]: inner }, required: [k] }), shape);
}
