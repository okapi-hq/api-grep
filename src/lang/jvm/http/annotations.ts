import type { Scoped } from "../../ir/language.js";
import type { Annotation, Expr, FunctionDef, Param } from "../../ir/model.js";
import { staticText } from "../../../resolve/parts.js";
import { evaluate } from "../../ir/evaluate.js";
import type { IrCtx, IrPair } from "../../ir/raw.js";

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

const pair = (name: string, value: Expr, fn: FunctionDef): IrPair => ({ where: "header", name: { expr: { k: "str", v: name.trim() }, fn }, value: { expr: value, fn } });

/**
 * A line built from pieces (`"Accept: $ACCEPT_JSON"`, `"Authorization: Bearer " + TOKEN`): the name is the text before
 * the first colon, the rest the value. A name only known at run time is the whole line, so the call's headers are not
 * fully known.
 */
function templateLine(e: Expr, fn: FunctionDef, ctx: IrCtx): IrPair[] {
  const parts = e.k === "tmpl" || e.k === "concat" ? e.parts : [];
  let name = "";
  for (let i = 0; i < parts.length; i++) {
    const text = staticText(evaluate(parts[i]!, fn, ctx));
    if (text === undefined) break;
    const colon = text.indexOf(":");
    if (colon < 0) {
      name += text;
      continue;
    }
    name += text.slice(0, colon);
    if (!name.trim()) return [];
    return [pair(name, { k: "tmpl", parts: [{ k: "str", v: text.slice(colon + 1).trimStart() }, ...parts.slice(i + 1)] }, fn)];
  }
  return [{ where: "header", name: { expr: e, fn } }];
}

/** `@Headers("Content-Type: application/json", "X-Key: {key}", "Accept: $ACCEPT_JSON")` (Feign, Retrofit): one header pair per line. */
export function headerLines(a: Annotation | undefined, fn: FunctionDef, ctx: IrCtx): IrPair[] {
  const lines = (a?.args ?? []).flatMap((x) => (x.value.k === "list" ? x.value.items : [x.value]));
  return lines.flatMap((e): IrPair[] => {
    const line = literal(e) ?? staticText(evaluate(e, fn, ctx));
    if (line === undefined) return templateLine(e, fn, ctx);
    const i = line.indexOf(":");
    return i > 0 ? [pair(line.slice(0, i), { k: "str", v: line.slice(i + 1).trim() }, fn)] : [];
  });
}

/** A parameter read in its method: what the method's callers pass (#39) unless a wrapper substitutes it. */
export const paramRef = (p: Param, m: FunctionDef): Scoped => ({ expr: { k: "name", name: p.name, pos: m.pos }, fn: m });
