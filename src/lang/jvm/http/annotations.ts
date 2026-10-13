import type { Scoped } from "../../ir/language.js";
import type { Annotation, Expr, FunctionDef, Param } from "../../ir/model.js";
import type { IrPair } from "../../ir/raw.js";

/** The class name an annotation is written with (`GET`, `retrofit2.http.GET` -> `GET`). */
export const annName = (a: Annotation): string | undefined => (a.type.k === "name" || a.type.k === "attr" ? a.type.name : a.type.k === "qname" ? a.type.path[a.type.path.length - 1] : undefined);

export const findAnn = (anns: Annotation[] | undefined, names: string[]): Annotation | undefined => anns?.find((a) => names.includes(annName(a) ?? ""));

/** `@GetMapping("/x")`, `@GetMapping(value = ["/x"])`, `@GetMapping(path = "/x")`: the first value. */
export function annArg(a: Annotation | undefined, names: string[]): Expr | undefined {
  const named = a?.args.find((x) => x.name && names.includes(x.name))?.value;
  const v = named ?? (names.includes("value") ? a?.args.find((x) => !x.name)?.value : undefined);
  return v?.k === "list" ? v.items[0] : v;
}

export const literal = (e: Expr | undefined): string | undefined => (e?.k === "str" ? e.v : undefined);

/** `@Headers("Content-Type: application/json", "X-Key: {key}")` (Feign, Retrofit): one header pair per line. */
export function headerLines(a: Annotation | undefined, fn: FunctionDef): IrPair[] {
  const lines = (a?.args ?? []).flatMap((x) => (x.value.k === "list" ? x.value.items : [x.value])).flatMap((e) => literal(e) ?? []);
  return lines.flatMap((line): IrPair[] => {
    const i = line.indexOf(":");
    if (i <= 0) return [];
    return [{ where: "header", name: { expr: { k: "str", v: line.slice(0, i).trim() }, fn }, value: { expr: { k: "str", v: line.slice(i + 1).trim() }, fn } }];
  });
}

/** A parameter read in its method: what the method's callers pass (#39) unless a wrapper substitutes it. */
export const paramRef = (p: Param, m: FunctionDef): Scoped => ({ expr: { k: "name", name: p.name, pos: m.pos }, fn: m });
