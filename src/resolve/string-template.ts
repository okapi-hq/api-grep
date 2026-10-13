import type { Part, Shape } from "../types.js";
import { partsToTemplate, staticText } from "./parts.js";

/**
 * The text of a string built from literal and computed parts (`` `eth_${kind}` ``, `"eth_" + kind`), with `{name}`
 * for each computed part. The report's shape of such a string is a plain `string`; the text is kept beside it, keyed
 * by the shape object, for facts that name what the string holds (a JSON-RPC method) without changing the shape.
 */
const templates = new WeakMap<Shape, Part[]>();

/** The shape of an evaluated string: a one-value enum when every part is literal, else a string remembering its text. */
export function stringShapeOf(parts: Part[]): Shape {
  const text = staticText(parts);
  if (text !== undefined) return { type: "string", enum: [text] };
  const shape: Shape = { type: "string" };
  if (parts.some((p) => p.kind === "static" && p.text !== "")) templates.set(shape, parts);
  return shape;
}

/** The `{name}` text of a string shape built by `stringShapeOf` with some literal part. */
export function templateOf(shape: Shape): string | undefined {
  const parts = templates.get(shape);
  return parts && partsToTemplate(parts);
}

/** The parts of a string shape built by `stringShapeOf`: its one literal value, or the text it remembers. */
export function partsOf(shape: Shape): Part[] | undefined {
  if (shape.type !== "string") return undefined;
  const value = shape.enum?.length === 1 ? shape.enum[0] : undefined;
  return typeof value === "string" ? [{ kind: "static", text: value }] : templates.get(shape);
}

/**
 * The literal text of such a string with `gap` for each computed part. A GraphQL document read with `{name}`
 * placeholders would select a field `name` (a `${Fragment}` not resolved, `` `${a} ${b}` `` sent as a search query).
 */
export function literalOf(shape: Shape, gap: string): string | undefined {
  return templates.get(shape)?.map((p) => (p.kind === "static" ? p.text : gap)).join("");
}
