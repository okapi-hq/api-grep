import { templateOf } from "../resolve/string-template.js";
import type { Shape } from "../types.js";

/** The operation names a value can hold, and whether some of it is not known statically. */
export interface Names {
  names: string[];
  dynamic: boolean;
}

function collect(s: Shape, acc: Names, depth: number): void {
  if (depth > 6) return;
  if (s.type === "union") {
    for (const member of s.anyOf) collect(member, acc, depth + 1);
    return;
  }
  const values = s.type === "string" ? (s.enum ?? []).filter((v): v is string => typeof v === "string" && v !== "") : [];
  // a computed name keeps its literal parts (`eth_{kind}`); anything else with no literal value is unknown
  const template = s.type === "string" && values.length === 0 ? templateOf(s) : undefined;
  if (values.length === 0) acc.dynamic = true;
  for (const v of template ? [template] : values) if (!acc.names.includes(v)) acc.names.push(v);
}

/** The names of a string shape: its literal values (every branch of a union), else its computed text. */
export function namesOf(s: Shape): Names {
  const acc: Names = { names: [], dynamic: false };
  collect(s, acc, 0);
  return acc;
}
