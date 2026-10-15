import { isSafeKey } from "../../record-keys.js";
import type { BodyResult } from "../../resolve/body.js";
import { staticText } from "../../resolve/parts.js";
import { jsonToShape, unionOf } from "../../resolve/shape-utils.js";
import { stringShapeOf } from "../../resolve/string-template.js";
import { xmlBody } from "../../resolve/xml-shape.js";
import type { BodyEncoding, DynamicOrigin, DynamicPart, Part, Shape } from "../../types.js";
import { leadingText, splitParts, type DataItem, type FormItem } from "./request.js";

type Hole = Exclude<Part, { kind: "static" }>;

export const originOf = (p: Hole): DynamicOrigin => (p.kind === "env" ? "env" : p.origin);

/** A value that is one env read or one unknown value: a string read from it, else a string of the text around it. */
export function valueShape(parts: Part[]): Shape {
  const hole = parts.length === 1 && parts[0]!.kind !== "static" ? (parts[0] as Hole) : undefined;
  if (hole?.kind === "env") return { type: "string", env: hole.name, ...(hole.fallback !== undefined ? { enum: [hole.fallback] } : {}) };
  if (hole && /^[A-Za-z_]\w*$/.test(hole.name)) return { type: "string", hint: hole.name };
  return stringShapeOf(parts);
}

/** `{where, name}` for every value part of `parts`, named after the key it fills. */
export function holesOf(parts: Part[], where: DynamicPart["where"], name: string): DynamicPart[] {
  return parts.filter((p): p is Hole => p.kind !== "static").map((p) => ({ where, name, origin: originOf(p) }));
}

const OPEN = "\ue000";
const CLOSE = "\ue001";
const TOKEN_RE = /\ue000(\d+)\ue001/g;

interface Template {
  text: string;
  holes: { part: Hole; quoted: boolean }[];
}

/** JSON text with a marker for each value written into it; a value outside a string stands as a string of its marker. */
function jsonTemplate(parts: Part[]): Template {
  const out: Template = { text: "", holes: [] };
  let inString = false;
  let escaped = false;
  for (const p of parts) {
    if (p.kind !== "static") {
      const token = `${OPEN}${out.holes.length}${CLOSE}`;
      out.holes.push({ part: p, quoted: inString });
      out.text += inString ? token : `"${token}"`;
      continue;
    }
    for (const ch of p.text) {
      if (escaped) escaped = false;
      else if (ch === "\\" && inString) escaped = true;
      else if (ch === '"') inString = !inString;
    }
    out.text += p.text;
  }
  return out;
}

function stringOf(s: string, t: Template, key: string, dynamic: DynamicPart[]): Shape {
  const whole = new RegExp(`^${OPEN}(\\d+)${CLOSE}$`).exec(s);
  if (whole) {
    const hole = t.holes[Number(whole[1])]!;
    dynamic.push({ where: "body", name: key, origin: originOf(hole.part) });
    return hole.quoted ? valueShape([hole.part]) : { type: "dynamic", origin: originOf(hole.part), hint: hole.part.name };
  }
  if (!s.includes(OPEN)) return { type: "string", enum: [s] };
  const parts: Part[] = [];
  let pos = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m.index > pos) parts.push({ kind: "static", text: s.slice(pos, m.index) });
    const hole = t.holes[Number(m[1])]!.part;
    parts.push(hole);
    dynamic.push({ where: "body", name: key, origin: originOf(hole) });
    pos = m.index + m[0].length;
  }
  if (pos < s.length) parts.push({ kind: "static", text: s.slice(pos) });
  return stringShapeOf(parts);
}

function shapeOfValue(v: unknown, t: Template, key: string, dynamic: DynamicPart[]): Shape {
  if (typeof v === "string") return stringOf(v, t, key, dynamic);
  if (Array.isArray(v)) {
    return { type: "array", items: unionOf(v.map((x) => shapeOfValue(x, t, key, dynamic))) };
  }
  if (v === null || typeof v !== "object") return jsonToShape(v);
  const properties: Record<string, Shape> = {};
  let dynamicKeys = false;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.includes(OPEN)) dynamicKeys = true;
    else if (isSafeKey(k)) properties[k] = shapeOfValue(x, t, k, dynamic);
  }
  return { type: "object", properties, required: Object.keys(properties), ...(dynamicKeys ? { dynamicKeys } : {}) };
}

/** A JSON document written in a script, with shell values in it (`'{"text":"'"$MSG"'"}'`); undefined when it is not JSON. */
export function jsonBody(parts: Part[]): { shape: Shape; dynamic: DynamicPart[] } | undefined {
  // the markers must stand for the script's values only
  if (parts.some((p) => p.kind === "static" && (p.text.includes(OPEN) || p.text.includes(CLOSE)))) return undefined;
  const t = jsonTemplate(parts);
  let value: unknown;
  try {
    value = JSON.parse(t.text);
  } catch {
    return undefined;
  }
  const dynamic: DynamicPart[] = [];
  return { shape: shapeOfValue(value, t, "body", dynamic), dynamic };
}

/** `name=value` pairs (form data, query items) as an object of their names. */
export function pairsShape(pairs: Part[][], where: DynamicPart["where"]): { shape: Shape & { type: "object" }; dynamic: DynamicPart[] } {
  const properties: Record<string, Shape> = {};
  const dynamic: DynamicPart[] = [];
  for (const pair of pairs) {
    const [k, v] = splitParts(pair, "=", 1);
    const key = k ? staticText(k)?.trim() : undefined;
    if (!key || !isSafeKey(key) || /\s/.test(key)) continue;
    properties[key] = v ? valueShape(v) : { type: "string" };
    if (v) dynamic.push(...holesOf(v, where, key));
  }
  return { shape: { type: "object", properties, required: Object.keys(properties) }, dynamic };
}

const result = (shape: Shape, encoding: BodyEncoding, dynamic: DynamicPart[], fromLiteral = true): BodyResult => ({ shape, encoding, dynamic, fromLiteral });

/** `-F` fields: a multipart body of their names; a file field is a string. */
export function formBody(items: FormItem[]): BodyResult {
  const pairs = pairsShape([], "body");
  for (const f of items) {
    if (!isSafeKey(f.name)) continue;
    pairs.shape.properties[f.name] = f.file ? { type: "string" } : valueShape(f.value);
    pairs.shape.required.push(f.name);
    if (!f.file) pairs.dynamic.push(...holesOf(f.value, "body", f.name));
  }
  return result(pairs.shape, "multipart", pairs.dynamic);
}

/** The data of a command, joined as curl sends it: `-d` values with `&`, `--json` values as they are. */
function joined(items: DataItem[]): Part[] {
  return items.flatMap((d, i) => [...(i > 0 && d.kind !== "json" ? [{ kind: "static", text: "&" } as Part] : []), ...d.parts]);
}

const FORM_PAIR = /^[\w.\-[\]]+=/;

/** A body given as text: JSON, XML, `a=1&b=2` form data, else raw text. */
export function textBody(parts: Part[]): BodyResult {
  const lead = leadingText(parts).trimStart();
  const json = lead.startsWith("{") || lead.startsWith("[") ? jsonBody(parts) : undefined;
  if (json) return result(json.shape, "json", json.dynamic);
  const xml = lead.startsWith("<") ? xmlBody(parts) : undefined;
  if (xml) return result(xml.shape, "xml", xml.dynamic);
  if (FORM_PAIR.test(lead)) {
    const form = pairsShape(splitParts(parts, "&"), "body");
    return result(form.shape, "form", form.dynamic);
  }
  const hole = parts.length === 1 && parts[0]!.kind !== "static" ? (parts[0] as Hole) : undefined;
  if (hole) return result({ type: "dynamic", origin: originOf(hole), hint: hole.name }, "raw", [{ where: "body", name: hole.name, origin: originOf(hole) }], false);
  return result(stringShapeOf(parts), "raw", holesOf(parts, "body", "body"));
}

/** Data items as a body; a file's content (`@payload.json`) is read by `readFile` when it is a JSON file of the repository. */
export function dataBody(items: DataItem[], readFile: (path: Part[]) => string | undefined): BodyResult {
  const file = items.find((d) => d.file);
  if (file) {
    const text = items.length === 1 ? readFile(file.file!) : undefined;
    const json = text !== undefined ? jsonBody([{ kind: "static", text }]) : undefined;
    if (json) return result(json.shape, "json", []);
    return result({ type: "unknown" }, file.kind === "json" ? "json" : "raw", [{ where: "body", name: "body", origin: "unknown" }], false);
  }
  const body = textBody(joined(items));
  // `--json` sends JSON whatever it holds
  if (items.some((d) => d.kind === "json")) body.encoding = "json";
  return body;
}
