import { addBranch } from "../ir/edits.js";
import type { ClassDef, Expr, FunctionDef } from "../ir/model.js";
import { stringBuilderStart } from "../jvm/calls.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { lowerArgs, lowerExpr, recordAppends, unknown } from "./lower-expr.js";
import { lowerFnHooks } from "./lower-fn.js";
import { hook, inBlock, named, nameRef, posOf, setHooks, type JState } from "./state.js";
import { lowerType } from "./types.js";

const NONE: Expr = { k: "unknown", text: "" };

export function addField(cls: ClassDef, name: string, value: Expr, fn: FunctionDef): void {
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn }]);
}

/** `String a = x, b;`, `var c = ...`, a resource of `try (...)`: assignments of the function, typed when they say so. */
function lowerDeclarators(n: SyntaxNode, st: JState): void {
  const type = lowerType(n.childForFieldName("type") ?? undefined, st);
  const declarators = n.type === "resource" ? [n] : n.childrenForFieldName("declarator").filter((d): d is SyntaxNode => !!d);
  for (const d of declarators) {
    const name = d.childForFieldName("name")?.text;
    const v = d.childForFieldName("value");
    const value = v ? lowerExpr(v, st) : undefined;
    if (!name) continue;
    if (value || type) st.fn.assigns.push({ target: name, value: value ?? NONE, offset: d.endIndex, ...(type ? { type } : {}) });
    st.scope.names.add(name);
    const start = stringBuilderStart(value);
    if (start) st.builders.set(name, [...start]);
  }
}

/** `x = v`, `x += v`, `this.x = v`, a bare field name (`url = v` in a constructor), `conn.doOutput = true`. */
function lowerAssignment(n: SyntaxNode, st: JState): Expr {
  const left = n.childForFieldName("left");
  const right = n.childForFieldName("right");
  const op = n.childForFieldName("operator")?.text ?? "=";
  const value = right ? lowerExpr(right, st) : unknown(n);
  if (!left || (op !== "=" && op !== "+=")) return value;
  const target = left.type === "identifier" ? nameRef(left.text, posOf(left), st) : left.type === "field_access" ? lowerExpr(left, st) : undefined;
  if (target?.k === "name") st.fn.assigns.push({ target: target.name, value, offset: n.endIndex, ...(op === "+=" ? { augmented: true } : {}) });
  else if (target?.k === "attr" && target.obj.k === "this" && st.cls && op === "=") addField(st.cls.def, target.name, value, st.fn);
  else if (target?.k === "attr" && target.obj.k === "name" && op === "=") st.fn.assigns.push({ target: `${target.obj.name}.${target.name}`, value, offset: n.endIndex });
  return value;
}

/** `setContentType` -> `contentType`, `setURL` -> `URL` (the JavaBeans rule). */
const beanProperty = (setter: string): string => {
  const rest = setter.slice(3);
  return /^[A-Z]{2}/.test(rest) ? rest : rest.charAt(0).toLowerCase() + rest.slice(1);
};

/**
 * `headers.setContentType(t);` on a local is also the property it sets (`headers.contentType`), as Kotlin writes it:
 * readers of `x.prop = v` assignments (connection settings, header maps) need nothing else.
 */
function beanSetter(n: SyntaxNode, call: Expr, st: JState): void {
  if (call.k !== "call" || call.fn.k !== "attr" || call.fn.obj.k !== "name" || call.args.length !== 1) return;
  if (!/^set[A-Z]/.test(call.fn.name)) return;
  st.fn.assigns.push({ target: `${call.fn.obj.name}.${beanProperty(call.fn.name)}`, value: call.args[0]!.value, offset: n.endIndex });
}

function lowerExpressionStatement(n: SyntaxNode, st: JState): void {
  const e = named(n)[0];
  if (!e) return;
  if (e.type === "assignment_expression") lowerAssignment(e, st);
  else if (e.type === "method_invocation") {
    const call = lowerExpr(e, st);
    if (call.k === "call") recordAppends(call, st);
    beanSetter(n, call, st);
  }
  else lowerExpr(e, st);
}

/** `try (A a = ...; B b = ...) { ... } catch (E e) { ... } finally { ... }`. */
function lowerTry(n: SyntaxNode, st: JState): void {
  const inner = inBlock(st);
  for (const r of named(n.childForFieldName("resources") ?? n).filter((c) => c.type === "resource")) {
    if (r.childForFieldName("name")) lowerDeclarators(r, inner);
    else for (const c of named(r)) lowerExpr(c, inner);
  }
  for (const c of named(n)) {
    if (c.type === "block") lowerStatement(c, inner);
    else if (c.type === "catch_clause") {
      const handler = inBlock(st);
      const param = named(c).find((x) => x.type === "catch_formal_parameter")?.childForFieldName("name")?.text;
      if (param) handler.scope.names.add(param);
      const body = c.childForFieldName("body");
      addBranch(st.fn, c.startIndex, c.endIndex);
      if (body) lowerStatement(body, handler);
    } else if (c.type === "finally_clause") for (const b of named(c)) lowerStatement(b, st);
  }
}

/** `for (init; cond; update) body` and `for (T x : items) body`: the loop variables are names of the body. */
function lowerFor(n: SyntaxNode, st: JState): void {
  const inner = inBlock(st);
  if (n.type === "enhanced_for_statement") {
    const value = n.childForFieldName("value");
    const over = value ? lowerExpr(value, st) : undefined;
    const name = n.childForFieldName("name")?.text;
    if (name) inner.scope.names.add(name);
    if (name && over) (st.fn.loops ??= []).push({ name, over, from: n.startIndex, to: n.endIndex });
  } else {
    for (const i of n.childrenForFieldName("init")) if (i) lowerAny(i, inner);
    for (const f of ["condition", "update"]) for (const c of n.childrenForFieldName(f)) if (c) lowerExpr(c, inner);
  }
  const body = n.childForFieldName("body");
  if (body) addBranch(st.fn, body.startIndex, body.endIndex);
  if (body) lowerStatement(body, inner);
}

/** The blocks of an `if` (exactly one runs when it has an `else`) and a loop body: they may not run (`ir/edits.ts`). */
function markBranches(n: SyntaxNode, fn: FunctionDef): void {
  if (n.type === "if_statement") {
    const blocks = [n.childForFieldName("consequence"), n.childForFieldName("alternative")].filter((b): b is SyntaxNode => !!b);
    const group = blocks.length === 2 ? { id: n.startIndex, size: 2 } : undefined;
    for (const b of blocks) addBranch(fn, b.startIndex, b.endIndex, group);
  } else if (n.type.endsWith("while_statement")) {
    const body = n.childForFieldName("body");
    if (body) addBranch(fn, body.startIndex, body.endIndex);
  }
}

const STATEMENTS = new Set(["block", "local_variable_declaration", "expression_statement", "if_statement", "while_statement", "do_statement", "for_statement", "enhanced_for_statement"]);
const MORE_STATEMENTS = ["try_statement", "try_with_resources_statement", "return_statement", "yield_statement", "throw_statement", "synchronized_statement", "labeled_statement", "switch_expression"];
for (const s of MORE_STATEMENTS) STATEMENTS.add(s);

/** A statement or an expression in a statement position (a `for` header). */
function lowerAny(n: SyntaxNode, st: JState): void {
  if (STATEMENTS.has(n.type) || n.type.endsWith("_declaration")) lowerStatement(n, st);
  else lowerExpr(n, st);
}

/** A statement; calls and assignments are recorded in the current function. */
export function lowerStatement(n: SyntaxNode, st: JState): void {
  switch (n.type) {
    case "block":
    case "constructor_body": {
      const inner = inBlock(st);
      for (const c of named(n)) lowerStatement(c, inner);
      return;
    }
    case "local_variable_declaration":
      return lowerDeclarators(n, st);
    case "expression_statement":
      return lowerExpressionStatement(n, st);
    case "return_statement":
    case "yield_statement": {
      const e = named(n)[0];
      const value = e ? lowerExpr(e, st) : undefined;
      if (value && n.type === "return_statement") st.fn.returns.push(value);
      if (n.type === "return_statement") (st.fn.exits ??= []).push({ offset: n.startIndex });
      if (value && n.type === "yield_statement") st.yields?.push(value);
      return;
    }
    case "for_statement":
    case "enhanced_for_statement":
      return lowerFor(n, st);
    case "try_statement":
    case "try_with_resources_statement":
      return lowerTry(n, st);
    case "explicit_constructor_invocation":
      lowerArgs(n.childForFieldName("arguments") ?? undefined, st);
      return;
    case "switch_expression":
      hook("switchValue")(n, st);
      return;
    default:
      return lowerOtherStatement(n, st);
  }
}

function lowerOtherStatement(n: SyntaxNode, st: JState): void {
  if (n.type.endsWith("_declaration") && n.type !== "local_variable_declaration") return hook("classDecl")(n, st, false);
  if (n.type === "if_statement" || n.type.endsWith("while_statement") || n.type === "do_statement" || n.type === "labeled_statement" || n.type === "synchronized_statement") {
    markBranches(n, st.fn);
    for (const c of named(n)) lowerAny(c, STATEMENTS.has(c.type) ? inBlock(st) : st);
    return;
  }
  for (const c of named(n)) lowerAny(c, st);
}

setHooks({ statement: lowerStatement, assignment: lowerAssignment, ...lowerFnHooks });
