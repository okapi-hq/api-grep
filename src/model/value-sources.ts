import { VALUE_SOURCES, type Shape, type ValueSource } from "../types.js";

/**
 * Where a scalar value the code can send comes from when it is no literal of its own: a fallback (`model or "gpt-4o"`,
 * a parameter's or a settings field's default), a config file the code loads by a literal path. Kept on the shape
 * under a symbol, so it never reaches a report's shapes; the model fact (`fact.ts`) lists it per value.
 */

type Scalar = string | number | boolean;
type Sources = ReadonlyMap<Scalar, ValueSource>;

const sourcesOn = (s: Shape): Sources | undefined => (s.type === "string" || s.type === "number" || s.type === "integer" || s.type === "boolean" ? s[VALUE_SOURCES] : undefined);

/** The source of each value of a scalar shape that has one; a value without is written in the code. */
export function valueSources(s: Shape): Sources | undefined {
  return sourcesOn(s);
}

/**
 * The shape with every literal value it holds (through unions) given `source`, unless it already has one: a fallback's
 * value read from a config file stays the config file's.
 */
export function withSource(shape: Shape, source: ValueSource, depth = 0): Shape {
  if (depth > 6) return shape;
  if (shape.type === "union") return { ...shape, anyOf: shape.anyOf.map((m) => withSource(m, source, depth + 1)) };
  if (shape.type !== "string" && shape.type !== "number" && shape.type !== "integer" && shape.type !== "boolean") return shape;
  if (!shape.enum?.length) return shape;
  const prev = shape[VALUE_SOURCES];
  const next = new Map<Scalar, ValueSource>(shape.enum.map((v) => [v, prev?.get(v) ?? source]));
  return { ...shape, [VALUE_SOURCES]: next };
}

/** A fallback's values (`x or "a"`, `x ?? "a"`, a default argument): defaults, unless they say where they come from. */
export const asDefault = (shape: Shape): Shape => withSource(shape, { from: "default" });

/**
 * The sources of the values of shapes merged into one (`mergeLiterals`): a value one of them writes as a literal stays
 * a literal, else it keeps the first source given.
 */
export function mergedSources(shapes: Shape[], values: Scalar[]): Sources | undefined {
  if (!shapes.some((s) => sourcesOn(s)?.size)) return undefined;
  const out = new Map<Scalar, ValueSource>();
  for (const v of values) {
    const holders = shapes.filter((s) => "enum" in s && s.enum?.includes(v));
    const found = holders.map((s) => sourcesOn(s)?.get(v));
    if (found.every((f) => f !== undefined)) out.set(v, found[0]!);
  }
  return out.size > 0 ? out : undefined;
}
