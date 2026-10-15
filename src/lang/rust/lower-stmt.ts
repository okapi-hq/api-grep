import type { Expr, FunctionDef, Param } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerExpr, newFunction } from "./lower-expr.js";
import { lowerItem } from "./lower.js";
import { posOf, type RustState } from "./names.js";
import { lowerType } from "./types.js";

/**
 * Statements: `let` bindings, assignments (`x = v`, `x += v`, `self.f = v` a field of the type, `obj.f = v` an
 * attribute set on a local, `body["k"] = v` a key added to a map), items declared in a body, and blocks, whose value is
 * their trailing expression.
 */

/** Where a node ends, as the lowering's offsets count (macro arguments are parsed apart, see `SHIFT`). */
export const endOf = (n: SyntaxNode): number => posOf(n).offset + (n.endIndex - n.startIndex);

/** The identifier a pattern binds: `x`, `mut x`, `Some(x)`, `Ok(x)`; undefined for others. */
function boundName(p: SyntaxNode | undefined): SyntaxNode | undefined {
  if (!p) return undefined;
  if (p.type === "identifier") return p;
  if (p.type === "mut_pattern" || p.type === "ref_pattern") return boundName(named(p).at(-1));
  if (p.type !== "tuple_struct_pattern") return undefined;
  const type = field(p, "type");
  const inner = named(p).filter((c) => c.id !== type?.id);
  return inner.length === 1 ? boundName(inner[0]) : undefined;
}

/** Binds a pattern's variable to a value: `let x = v`, `if let Some(x) = v`, a match arm's `Ok(x)`. */
export function bindPattern(pattern: SyntaxNode | undefined, value: Expr, offset: number, st: RustState, type?: Expr): void {
  const id = boundName(pattern);
  if (!id || id.text === "_") return;
  st.locals.add(id.text);
  st.fn.assigns.push({ target: id.text, value, offset, ...(type ? { type } : {}) });
}

function lowerLet(n: SyntaxNode, st: RustState): void {
  const pattern = field(n, "pattern");
  const valueNode = field(n, "value");
  const type = lowerType(field(n, "type"), st);
  const value = valueNode ? lowerExpr(valueNode, st) : type ? ({ k: "unknown", text: "uninitialized" } as Expr) : undefined;
  const alt = field(n, "alternative");
  if (alt) lowerExpr(alt, st);
  // `let (a, b) = (x, y);`
  if (pattern?.type === "tuple_pattern" && value?.k === "list") {
    named(pattern).forEach((p, i) => (value.items[i] ? bindPattern(p, value.items[i], endOf(n), st) : undefined));
    return;
  }
  if (!value) return;
  bindPattern(pattern, value, endOf(n), st, type);
  const id = boundName(pattern);
  if (id && valueNode && /^(?:url::)?Url::parse\s*\(/.test(valueNode.text)) st.urls.add(id.text);
}

function addField(st: RustState, name: string, value: Expr): void {
  const cls = st.fn.cls!;
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn: st.fn }]);
}

function lowerAssignment(n: SyntaxNode, st: RustState): void {
  const left = field(n, "left");
  const right = field(n, "right");
  if (!left || !right) return;
  const value = lowerExpr(right, st);
  const op = n.type === "compound_assignment_expr" ? field(n, "operator")?.text : "=";
  const offset = endOf(n);
  if (left.type === "identifier" && (op === "=" || op === "+=")) {
    st.fn.assigns.push({ target: left.text, value, offset, ...(op === "+=" ? { augmented: true } : {}) });
    return;
  }
  const obj = left.type === "field_expression" || left.type === "index_expression" ? named(left)[0] : undefined;
  if (op === "=" && left.type === "field_expression" && obj) {
    const name = field(left, "field")!.text;
    if (obj.type === "self" && st.fn.cls) return addField(st, name, value);
    if (obj.type === "identifier") return void (st.fn.attrSets ??= []).push({ target: obj.text, name, value, offset });
  }
  const key = left.type === "index_expression" ? named(left)[1] : undefined;
  if (op === "=" && obj?.type === "identifier" && key) {
    st.fn.assigns.push({ target: obj.text, value: { k: "dict", entries: [{ key: lowerExpr(key, st), value }] }, offset, edit: "merge" });
    return;
  }
  lowerExpr(left, st);
}

function lowerStatement(c: SyntaxNode, st: RustState): void {
  if (c.type === "let_declaration") return lowerLet(c, st);
  if (c.type === "expression_statement") {
    const e = named(c)[0];
    if (e?.type === "assignment_expression" || e?.type === "compound_assignment_expr") return lowerAssignment(e, st);
    if (e) lowerExpr(e, st);
    return;
  }
  if (!lowerItem(c, [], st)) lowerExpr(c, st);
}

/** A block's statements; its value is its trailing expression (unknown without one). */
export function lowerBlock(n: SyntaxNode, st: RustState): Expr {
  const items = named(n).filter((c) => !c.type.endsWith("comment") && c.type !== "attribute_item");
  let value: Expr = { k: "unknown", text: "()" };
  items.forEach((c, i) => {
    const tail = i === items.length - 1 && c.type !== "let_declaration" && (c.type !== "expression_statement" || !c.text.trimEnd().endsWith(";"));
    if (tail && c.type !== "expression_statement" && c.type !== "empty_statement" && !c.type.endsWith("_item")) value = lowerExpr(c, st);
    else if (tail && c.type === "expression_statement") value = lowerExpr(named(c)[0]!, st);
    else lowerStatement(c, st);
  });
  return value;
}

/** Parameters, by position; `self` is the receiver (`this`), not a parameter. */
export function lowerParams(n: SyntaxNode | undefined, st: RustState): Param[] {
  const params: Param[] = [];
  for (const p of n ? named(n) : []) {
    if (p.type !== "parameter" && p.type !== "identifier") continue;
    const id = p.type === "identifier" ? p : boundName(field(p, "pattern"));
    const type = p.type === "parameter" ? lowerType(field(p, "type"), st) : undefined;
    const name = id?.text ?? `_${params.length}`;
    params.push({ name, index: params.length, kind: "normal", ...(type ? { type } : {}) });
    st.locals.add(name);
  }
  return params;
}

/** `|x| ...` / `move || { ... }`: a function that sees every name of the function around it. */
export function lowerClosure(n: SyntaxNode, st: RustState): FunctionDef {
  const fn = newFunction("closure", st.mod, n, { cls: st.fn.cls, parent: st.fn, inherits: ["*"] });
  st.mod.allFunctions.push(fn);
  const inner: RustState = { ...st, fn, locals: new Set(st.locals) };
  fn.params = lowerParams(field(n, "parameters"), inner);
  const body = field(n, "body");
  const value = !body ? undefined : body.type === "block" ? lowerBlock(body, inner) : lowerExpr(body, inner);
  if (value && value.k !== "unknown") fn.returns.push(value);
  return fn;
}
