import { mergedSources } from "../model/value-sources.js";
import { VALUE_SOURCES, type DynamicOrigin, type Shape } from "../types.js";
import { unionOf } from "./shape-utils.js";
import { dedupe } from "./type-shape.js";

/**
 * The shape of a parameter no wrapper expansion substituted (#39), for every language: the values its sources give
 * (the arguments its callers pass, its default) as alternatives, and what the parameter alone says when one cannot be
 * read. Each front end finds the sources; this merges their shapes.
 */

export interface ValueShape {
  shape: Shape;
  fromLiteral: boolean;
  origin?: DynamicOrigin;
}

/** A value the code tells: a literal scalar, an env var, `null`, or a union of those. */
function knownValue(s: Shape): boolean {
  switch (s.type) {
    case "string":
      return !!s.enum?.length || !!s.env;
    case "number":
    case "integer":
    case "boolean":
      return !!s.enum?.length;
    case "null":
      return true;
    case "union":
      return s.anyOf.every(knownValue);
    default:
      return false;
  }
}

/** Literal scalars of one type as one shape with every value (`1024` and `4096`: an integer of either value). */
function sameTypeValues(shapes: Shape[]): Shape | undefined {
  const scalars = shapes.flatMap((s) => (s.type === "string" || s.type === "number" || s.type === "integer" || s.type === "boolean" ? [s] : []));
  if (scalars.length !== shapes.length || scalars.some((s) => !s.enum?.length || s.env)) return undefined;
  const type = scalars[0]?.type;
  if (!type || scalars.some((s) => s.type !== type)) return undefined;
  const values = [...new Set(scalars.flatMap((s) => s.enum ?? []))];
  const sources = mergedSources(scalars, values);
  return { type, enum: values, ...(sources ? { [VALUE_SOURCES]: sources } : {}) };
}

/** Unlike `unionOf`, a string with no value does not swallow the literal ones: they stay next to it. */
function alternativesOf(known: Shape[], unread?: Shape): Shape {
  const merged = sameTypeValues(known) ?? unionOf(known);
  if (!unread) return merged;
  return { type: "union", anyOf: dedupe([...(merged.type === "union" ? merged.anyOf : [merged]), unread]) };
}

/**
 * Scalars only: an object or a list a caller builds is read at that caller, where the wrapper is expanded. `someUnread`
 * says a source could not even be found (a spread argument, more callers than are read).
 */
export function paramValues(sources: ValueShape[], someUnread: boolean, unread: ValueShape): ValueShape {
  const known: ValueShape[] = [];
  let partly = false;
  for (const r of sources) {
    if (knownValue(r.shape)) {
      known.push(r);
      continue;
    }
    // `env.MODEL ?? "gpt-4o"` from a caller: its literal is a value, the rest is unread
    partly = true;
    const parts = r.shape.type === "union" ? r.shape.anyOf.filter((m) => m.type !== "null" && knownValue(m)) : [];
    if (parts.length > 0) known.push({ shape: parts.length === 1 ? parts[0]! : { type: "union", anyOf: parts }, fromLiteral: false, origin: r.origin });
  }
  if (known.length === 0) return unread;
  const shapes = known.map((r) => r.shape);
  if (someUnread || partly) return { shape: alternativesOf(shapes, unread.shape), fromLiteral: false, origin: "param" };
  const literal = known.every((r) => r.fromLiteral);
  return { shape: alternativesOf(shapes), fromLiteral: literal, ...(literal ? {} : { origin: known.find((r) => !r.fromLiteral)?.origin }) };
}
