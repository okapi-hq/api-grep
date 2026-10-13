import { addBranch } from "../ir/edits.js";
import type { ClassDef, Expr, FunctionDef, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr } from "./lower-expr.js";
import { injectedValue } from "../jvm/annotations.js";
import { modifiersOf, type Modifiers } from "./modifiers.js";
import { hook, inBlock, inFunction, isLocal, nameRef, newFunction, posOf, setHooks, type KtState, type Lambda } from "./state.js";
import { lowerType } from "./types.js";

const NONE: Expr = { k: "unknown", text: "" };
const isComment = (n: SyntaxNode): boolean => n.type.endsWith("comment");

/** Parameters (`fun get(@Query("n") limit: Int = 20)`): modifiers come before each one, its default after it. */
export function lowerParams(n: SyntaxNode | undefined, st: KtState): Param[] {
  const params: Param[] = [];
  let mods: Modifiers | undefined;
  for (const c of n ? named(n) : []) {
    if (c.type === "parameter_modifiers") mods = modifiersOf(c, st);
    else if (c.type === "parameter") {
      const [id, typeNode] = named(c);
      if (id?.type !== "identifier") continue;
      const type = lowerType(typeNode).type;
      const kind = mods?.keywords.has("vararg") ? "varargs" : "normal";
      params.push({ name: id.text, index: params.length, kind, ...(type ? { type } : {}), ...(mods?.annotations.length ? { annotations: mods.annotations } : {}) });
      mods = undefined;
    } else if (!isComment(c) && params.length > 0) params[params.length - 1]!.default = lowerExpr(c, st);
  }
  return params;
}

/** A function body: a block, or `= expr`, which it returns. */
function lowerBody(body: SyntaxNode | undefined, st: KtState): void {
  const b = body ? named(body).find((c) => !isComment(c)) : undefined;
  if (b?.type === "block") lowerBlock(b, st);
  else if (b) st.fn.returns.push(lowerExpr(b, st));
}

/** A `fun` (top level, method, or a local function closing over its parent) with its parameters and annotations. */
export function lowerFunction(n: SyntaxNode, st: KtState, closure: boolean): FunctionDef {
  const mods = modifiersOf(named(n).find((c) => c.type === "modifiers"), st);
  const extra: Partial<FunctionDef> = { cls: st.cls?.def, ...(closure ? { parent: st.fn, inherits: ["*"] } : {}) };
  const fn = newFunction(field(n, "name")?.text ?? "anonymous", st.mod, n, { ...extra, ...(mods.annotations.length ? { annotations: mods.annotations } : {}) });
  st.mod.allFunctions.push(fn);
  fn.params = lowerParams(named(n).find((c) => c.type === "function_value_parameters"), { ...st, fn });
  lowerBody(named(n).find((c) => c.type === "function_body"), inFunction(st, fn, closure));
  return fn;
}

/** `{ a, b -> ... }` (`it` when no parameter is named), `fun(x: Int) = ...`: a closure; its last expression is returned. */
function lowerLambda(n: SyntaxNode, st: KtState): Lambda {
  const lit = n.type === "annotated_lambda" ? (named(n).find((c) => c.type === "lambda_literal") ?? n) : n;
  const fn = newFunction("lambda", st.mod, lit, { cls: st.cls?.def, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  if (lit.type === "anonymous_function") {
    fn.params = lowerParams(named(lit).find((c) => c.type === "function_value_parameters"), { ...st, fn });
    lowerBody(named(lit).find((c) => c.type === "function_body"), inFunction(st, fn, true));
    return { fn, values: [] };
  }
  const paramsNode = named(lit).find((c) => c.type === "lambda_parameters");
  const names = paramsNode ? named(paramsNode).flatMap((p) => (p.type === "multi_variable_declaration" ? named(p) : [p])).map((p) => named(p)[0]?.text ?? "_") : ["it"];
  fn.params = names.map((name, index) => ({ name, index, kind: "normal" }));
  const inner = inFunction(st, fn, true);
  const values: Expr[] = [];
  for (const c of named(lit)) if (c.type !== "lambda_parameters" && !isComment(c)) values.push(lowerStatement(c, inner));
  const last = values[values.length - 1];
  if (last && last.k !== "unknown") fn.returns.push(last);
  return { fn, values };
}

/** The statements of a block, in a nested scope; its value is that of its last statement. */
function lowerBlock(n: SyntaxNode, st: KtState): Expr {
  const inner = inBlock(st);
  let value = NONE;
  for (const c of named(n)) if (!isComment(c)) value = lowerStatement(c, inner);
  return value;
}

/** What a property declaration says, lowered where it is written (a function, a class constructor, the file). */
export interface PropertyParts {
  name?: string;
  /** `val (a, b) = pair`. */
  destructured: string[];
  type?: Expr;
  nullable: boolean;
  /** The initializer, `by lazy { ... }`'s result, a getter's result, or a configuration value an annotation injects. */
  value?: Expr;
  /** Given a value where it is declared: a request body may leave it out. */
  initialized: boolean;
  hasGetter: boolean;
  mods: Modifiers;
}

const NOT_VALUE = new Set(["modifiers", "variable_declaration", "multi_variable_declaration", "property_delegate", "getter", "setter", "type_constraints", "type_parameters", "user_type", "nullable_type", "parenthesized_type"]);

/** `get() = "$base/x"`: a function of its own; the property's value is what a call of it returns. */
function accessor(n: SyntaxNode, st: KtState, name: string): Expr {
  const fn = newFunction(name, st.mod, n, { cls: st.cls?.def });
  st.mod.allFunctions.push(fn);
  lowerBody(named(n).find((c) => c.type === "function_body"), inFunction(st, fn, false));
  return { k: "call", fn: { k: "fnref", fn }, args: [], pos: posOf(n) };
}

export function propertyParts(n: SyntaxNode, st: KtState): PropertyParts {
  const kids = named(n).filter((c) => !isComment(c));
  const mods = modifiersOf(kids.find((c) => c.type === "modifiers"), st);
  const decl = kids.find((c) => c.type === "variable_declaration");
  const multi = kids.find((c) => c.type === "multi_variable_declaration");
  const [id, typeNode] = decl ? named(decl).filter((c) => c.type !== "annotation") : [];
  const { type, nullable } = lowerType(typeNode);
  const init = kids.find((c) => !NOT_VALUE.has(c.type));
  // `by lazy { ... }` is what the lambda returns; other delegates (`by inject()`) leave the declared type
  const delegated = kids.find((c) => c.type === "property_delegate");
  const delegate = delegated ? named(delegated).find((c) => !isComment(c)) : undefined;
  const getter = kids.find((c) => c.type === "getter");
  const setter = kids.find((c) => c.type === "setter");
  if (setter) accessor(setter, st, `set-${id?.text ?? ""}`);
  const lowered = init ? lowerExpr(init, st) : delegate ? lowerExpr(delegate, st) : getter ? accessor(getter, st, `get-${id?.text ?? ""}`) : undefined;
  const value = injectedValue(mods.annotations) ?? lowered;
  return {
    ...(id?.type === "identifier" ? { name: id.text } : {}),
    destructured: multi ? named(multi).flatMap((v) => named(v)[0]?.text ?? []) : [],
    ...(type ? { type } : {}),
    nullable,
    ...(value ? { value } : {}),
    initialized: !!init || !!delegate,
    hasGetter: !!getter,
    mods,
  };
}

/** `val x: T = v` in a function or at the top of a file: an assignment of that scope, typed when it says so. */
function lowerLocalProperty(n: SyntaxNode, st: KtState): void {
  const p = propertyParts(n, st);
  for (const d of p.destructured) st.scope.names.add(d);
  if (!p.name) return;
  if (p.value || p.type) st.fn.assigns.push({ target: p.name, value: p.value ?? NONE, offset: n.endIndex, ...(p.type ? { type: p.type } : {}) });
  st.scope.names.add(p.name);
}

export function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

/**
 * `body["k"] = v` on a local map: a key added to it (#38), folded into a `mutableMapOf(...)` literal by `ir/edits.ts`
 * and read as an entry of a `HashMap()` by `ir/fluent.ts`.
 */
function indexSet(left: SyntaxNode, value: Expr, offset: number, st: KtState): void {
  const [obj, key] = named(left);
  if (obj?.type !== "identifier" || !key || !isLocal(st.scope, obj.text)) return;
  st.fn.assigns.push({ target: obj.text, value: { k: "dict", entries: [{ key: lowerExpr(key, st), value }] }, offset, edit: "merge" });
}

/** `x = v`, `x += v`, `this.x = v`; a bare member name is the implicit `this`. */
function lowerAssignment(n: SyntaxNode, st: KtState): void {
  const left = field(n, "left");
  const right = field(n, "right");
  const op = field(n, "operator")?.text ?? "=";
  const value = right ? lowerExpr(right, st) : undefined;
  if (!left || !value || (op !== "=" && op !== "+=")) return;
  if (left.type === "index_expression" && op === "=") return indexSet(left, value, n.endIndex, st);
  const target = left.type === "identifier" ? nameRef(left.text, posOf(left), st) : left.type === "navigation_expression" ? lowerExpr(left, st) : undefined;
  if (target?.k === "name") st.fn.assigns.push({ target: target.name, value, offset: n.endIndex, ...(op === "+=" ? { augmented: true } : {}) });
  else if (target?.k === "attr" && target.obj.k === "this" && st.cls && op === "=") addField(st.cls.def, target.name, value, st.fn);
  // `conn.requestMethod = "POST"`: a property set on a local object, read by detectors as `conn.requestMethod`
  else if (target?.k === "attr" && target.obj.k === "name" && op === "=") st.fn.assigns.push({ target: `${target.obj.name}.${target.name}`, value, offset: n.endIndex });
}

/** `for (u in urls) { ... }`: the loop variables are names of its body. */
function lowerFor(n: SyntaxNode, st: KtState): void {
  addBranch(st.fn, n.startIndex, n.endIndex);
  const inner = inBlock(st);
  for (const c of named(n)) {
    if (c.type === "variable_declaration") inner.scope.names.add(named(c)[0]?.text ?? "");
    else if (c.type === "multi_variable_declaration") for (const v of named(c)) inner.scope.names.add(named(v)[0]?.text ?? "");
    else if (c.type !== "label" && c.type !== "annotation" && !isComment(c)) lowerStatement(c, inner);
  }
}

/** A statement; its value when it is an expression (the last one is the value of a block or a lambda). */
export function lowerStatement(c: SyntaxNode, st: KtState): Expr {
  switch (c.type) {
    case "block":
      return lowerBlock(c, st);
    case "property_declaration":
      lowerLocalProperty(c, st);
      return NONE;
    case "assignment":
      lowerAssignment(c, st);
      return NONE;
    case "function_declaration": {
      const fn = lowerFunction(c, st, true);
      st.fn.assigns.push({ target: fn.name, value: { k: "fnref", fn }, offset: c.startIndex });
      st.scope.names.add(fn.name);
      return NONE;
    }
    case "class_declaration":
    case "object_declaration":
      hook("classDecl")(c, st, false);
      return NONE;
    case "for_statement":
      lowerFor(c, st);
      return NONE;
    case "while_statement":
    case "do_while_statement":
      addBranch(st.fn, c.startIndex, c.endIndex);
      for (const x of named(c)) if (x.type !== "label" && !isComment(x)) lowerStatement(x, st);
      return NONE;
    case "type_alias":
      return NONE;
    default:
      return lowerExpr(c, st);
  }
}

/**
 * `object : Callback { override fun onResponse(...) { ... } }`: its functions are closures of the enclosing code. One
 * with a single function (`object : Interceptor { override fun intercept(...) }`) stands for it, like a lambda.
 */
function lowerObjectLiteral(n: SyntaxNode, st: KtState): FunctionDef | undefined {
  const body = named(n).find((c) => c.type === "class_body");
  const fns: FunctionDef[] = [];
  for (const m of body ? named(body) : []) {
    if (m.type === "function_declaration") fns.push(lowerFunction(m, st, true));
    else if (m.type === "property_declaration") propertyParts(m, st);
    else if (m.type === "anonymous_initializer") for (const b of named(m)) lowerStatement(b, st);
  }
  return fns.length === 1 ? fns[0] : undefined;
}

setHooks({ lambda: lowerLambda, statement: lowerStatement, objectLiteral: lowerObjectLiteral });
