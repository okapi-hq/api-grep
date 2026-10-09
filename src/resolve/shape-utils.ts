import { isSafeKey } from "../record-keys.js";
import type { Part, Shape } from "../types.js";
import { partsToTemplate } from "./parts.js";
import { dedupe, mergeLiterals } from "./type-shape.js";

export function unionOf(shapes: Shape[]): Shape {
  const items = dedupe(shapes);
  if (items.length === 0) return { type: "unknown" };
  if (items.length === 1) return items[0]!;
  return mergeLiterals(items) ?? { type: "union", anyOf: items };
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
