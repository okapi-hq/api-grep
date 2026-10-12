import type { DynamicOrigin, Shape } from "../types.js";
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
  return { type, enum: [...new Set(scalars.flatMap((s) => s.enum ?? []))] };
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
  const known = sources.filter((r) => knownValue(r.shape));
  if (known.length === 0) return unread;
  const shapes = known.map((r) => r.shape);
  if (someUnread || known.length < sources.length) return { shape: alternativesOf(shapes, unread.shape), fromLiteral: false, origin: "param" };
  const literal = known.every((r) => r.fromLiteral);
  return { shape: alternativesOf(shapes), fromLiteral: literal, ...(literal ? {} : { origin: known.find((r) => !r.fromLiteral)?.origin }) };
}
