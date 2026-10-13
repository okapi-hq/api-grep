import type { Annotation, Arg, Expr, FunctionDef, Param } from "../ir/model.js";
import { injectedValue } from "../jvm/annotations.js";
import { pathRef } from "../jvm/paths.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, unknown } from "./lower-expr.js";
import { hook, inFunction, named, newFunction, posOf, type JState } from "./state.js";
import { lowerType, typePath } from "./types.js";

/** Keywords (`static`, `final`, `transient`) and annotations of a declaration. */
export interface Modifiers {
  keywords: Set<string>;
  annotations: Annotation[];
}

/** An annotation argument: an expression, a nested annotation (not read), or `{a, b}` as a list. */
function annotationValue(n: SyntaxNode, st: JState): Expr {
  if (n.type === "element_value_array_initializer") return { k: "list", items: named(n).map((c) => annotationValue(c, st)) };
  if (n.type === "annotation" || n.type === "marker_annotation") return unknown(n);
  return lowerExpr(n, st);
}

/** `@GET("users/{id}")`, `@RequestMapping(value = "/x", method = RequestMethod.POST)`, `@Inject`. */
function lowerAnnotation(n: SyntaxNode, st: JState): Annotation | undefined {
  const nameNode = n.childForFieldName("name");
  const path = nameNode ? typePath(nameNode) : undefined;
  if (!path) return undefined;
  const argsNode = n.childForFieldName("arguments");
  const args = (argsNode ? named(argsNode) : []).map((a): Arg => {
    const key = a.type === "element_value_pair" ? a.childForFieldName("key") : undefined;
    const value = a.type === "element_value_pair" ? a.childForFieldName("value") : a;
    return { ...(key ? { name: key.text } : {}), value: value ? annotationValue(value, st) : unknown(a) };
  });
  return { type: pathRef(path, posOf(n)), args, pos: posOf(n) };
}

export function modifiersOf(n: SyntaxNode | undefined, st: JState): Modifiers {
  const out: Modifiers = { keywords: new Set(), annotations: [] };
  for (const c of n ? n.children : []) {
    if (!c) continue;
    if (c.type === "annotation" || c.type === "marker_annotation") {
      const a = lowerAnnotation(c, st);
      if (a) out.annotations.push(a);
    } else if (!c.isNamed) out.keywords.add(c.text);
  }
  return out;
}

export const modifiersNode = (n: SyntaxNode): SyntaxNode | undefined => named(n).find((c) => c.type === "modifiers");

/** `(@Query("q") String q, final int page, String... ids)`; Spring `@Value("${x:d}")` gives a parameter its value. */
export function lowerParams(n: SyntaxNode | undefined, st: JState): Param[] {
  const params: Param[] = [];
  for (const p of n ? named(n) : []) {
    if (p.type !== "formal_parameter" && p.type !== "spread_parameter") continue;
    const decl = p.type === "spread_parameter" ? named(p).find((c) => c.type === "variable_declarator") : p;
    const name = decl?.childForFieldName("name")?.text;
    if (!name) continue;
    const mods = modifiersOf(modifiersNode(p), st);
    const typeNode = p.childForFieldName("type") ?? named(p).find((c) => c.type !== "modifiers" && c.type !== "variable_declarator");
    const type = lowerType(typeNode, st);
    const value = injectedValue(mods.annotations);
    params.push({
      name,
      index: params.length,
      kind: p.type === "spread_parameter" ? "varargs" : "normal",
      ...(type ? { type } : {}),
      ...(value ? { default: value } : {}),
      ...(mods.annotations.length ? { annotations: mods.annotations } : {}),
    });
  }
  return params;
}

/** A method (or a method of an anonymous class, a closure of the code around it) with its parameters and annotations. */
export function lowerMethod(n: SyntaxNode, st: JState, closure: boolean): FunctionDef {
  const mods = modifiersOf(modifiersNode(n), st);
  const extra: Partial<FunctionDef> = {
    cls: st.cls?.def,
    ...(closure ? { parent: st.fn, inherits: ["*"] } : {}),
    ...(mods.annotations.length ? { annotations: mods.annotations } : {}),
    ...(mods.keywords.has("static") ? { isStatic: true } : {}),
  };
  const fn = newFunction(n.childForFieldName("name")?.text ?? "anonymous", st.mod, n, extra);
  st.mod.allFunctions.push(fn);
  fn.params = lowerParams(n.childForFieldName("parameters") ?? undefined, { ...st, fn });
  const returnType = lowerType(n.childForFieldName("type") ?? undefined, st);
  if (returnType) fn.returnType = returnType;
  const body = n.childForFieldName("body");
  if (body) hook("statement")(body, inFunction(st, fn, closure));
  return fn;
}

/** `x -> ...`, `(a, b) -> { ... }`, `(String s) -> ...`: a closure; an expression body is what it returns. */
function lowerLambda(n: SyntaxNode, st: JState): FunctionDef {
  const fn = newFunction("lambda", st.mod, n, { cls: st.cls?.def, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  const ps = n.childForFieldName("parameters");
  if (ps?.type === "formal_parameters") fn.params = lowerParams(ps, { ...st, fn });
  else {
    const names = ps?.type === "identifier" ? [ps] : ps ? named(ps).filter((c) => c.type === "identifier") : [];
    fn.params = names.map((p, index) => ({ name: p.text, index, kind: "normal" }));
  }
  const inner = inFunction(st, fn, true);
  const body = n.childForFieldName("body");
  if (body?.type === "block") hook("statement")(body, inner);
  else if (body) fn.returns.push(lowerExpr(body, inner));
  return fn;
}

/** `switch (k) { case A -> "a"; default -> { yield "b"; } }` as a value: any of its results, the first one first. */
function lowerSwitch(n: SyntaxNode, st: JState): Expr {
  const cond = n.childForFieldName("condition");
  if (cond) lowerExpr(cond, st);
  const inner: JState = { ...st, scope: { names: new Set(), parent: st.scope }, yields: [] };
  const values: Expr[] = [];
  for (const c of named(n.childForFieldName("body") ?? n)) {
    for (const x of c.type === "switch_rule" || c.type === "switch_block_statement_group" ? named(c) : []) {
      if (x.type === "switch_label") continue;
      if (c.type === "switch_rule" && x.type === "expression_statement" && named(x)[0]) values.push(lowerExpr(named(x)[0]!, inner));
      else hook("statement")(x, inner);
    }
  }
  values.push(...inner.yields!);
  return values.reduceRight<Expr | undefined>((rest, v) => (rest ? { k: "cond", then: v, else: rest } : v), undefined) ?? unknown(n);
}

export const lowerFnHooks = { lambda: lowerLambda, switchValue: lowerSwitch };
