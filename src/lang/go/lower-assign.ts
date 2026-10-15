import type { Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerType } from "./composite.js";
import { lowerExpr } from "./lower-expr.js";
import type { GoState } from "./names.js";

/**
 * Assignments: `x := v`, `x = v`, `x += v`, `var x T = v`, `const X = v`; `c.field = v` on the method's receiver is a
 * field of its class, `cfg.BaseURL = v` on a local an attribute set on what it holds, `m["k"] = v` a key added to a map.
 */

const listOf = (n: SyntaxNode | undefined): SyntaxNode[] => (!n ? [] : n.type === "expression_list" ? named(n) : [n]);

/**
 * The value each name gets: one per name, or the first value of a call returning several (`resp, err := f()`, `v, ok :=
 * m[k]`), Go's results putting the value first and the error or flag after it.
 */
function valueFor(values: Expr[], count: number, i: number): Expr | undefined {
  if (values.length === count) return values[i];
  return i === 0 ? values[0] : undefined;
}

/** Names declared with values (and a type): locals of the function, or package-level names at the top of a file. */
function bind(names: SyntaxNode[], values: SyntaxNode[], st: GoState, offset: number, type?: Expr): void {
  const lowered = values.map((v) => lowerExpr(v, st));
  names.forEach((name, i) => {
    if (name.text === "_") return;
    st.locals.add(name.text);
    const value = valueFor(lowered, names.length, i) ?? (type ? { k: "unknown", text: "zero value" } : undefined);
    if (value) st.fn.assigns.push({ target: name.text, value, offset, ...(type ? { type } : {}) });
  });
}

export function lowerShortVar(n: SyntaxNode, st: GoState): void {
  bind(listOf(field(n, "left")), listOf(field(n, "right")), st, n.endIndex);
}

/** A `var_spec` or `const_spec`; a constant without a value repeats the previous one's expression (`iota`): skipped. */
export function lowerSpec(n: SyntaxNode, st: GoState): void {
  const names = n.childrenForFieldName("name").filter((c): c is SyntaxNode => !!c);
  const values = listOf(field(n, "value"));
  if (values.length === 0 && n.type === "const_spec") return;
  bind(names, values, st, n.endIndex, lowerType(field(n, "type"), st));
}

function addField(st: GoState, name: string, value: Expr): void {
  const cls = st.fn.cls!;
  cls.fields.set(name, [...(cls.fields.get(name) ?? []), { value, fn: st.fn }]);
}

/** `c.baseURL = v` (the receiver's field), `cfg.BaseURL = v` (an attribute set on a local). */
function assignSelector(left: SyntaxNode, value: Expr, offset: number, st: GoState): boolean {
  const obj = field(left, "operand");
  const name = field(left, "field")?.text;
  if (obj?.type !== "identifier" || !name) return false;
  if (st.receiver && obj.text === st.receiver && st.fn.cls) addField(st, name, value);
  else (st.fn.attrSets ??= []).push({ target: obj.text, name, value, offset });
  return true;
}

/** `m["k"] = v`: a key added to the map `m` holds (`ir/edits.ts`). */
function assignIndex(left: SyntaxNode, value: Expr, offset: number, st: GoState): boolean {
  const obj = field(left, "operand");
  const key = field(left, "index");
  if (obj?.type !== "identifier" || !key || obj.text === st.receiver) return false;
  st.fn.assigns.push({ target: obj.text, value: { k: "dict", entries: [{ key: lowerExpr(key, st), value }] }, offset, edit: "merge" });
  return true;
}

function assignOne(left: SyntaxNode, value: Expr, op: string, offset: number, st: GoState): void {
  if (left.type === "identifier" && (op === "=" || op === "+=")) {
    if (left.text !== "_") st.fn.assigns.push({ target: left.text, value, offset, ...(op === "+=" ? { augmented: true } : {}) });
    return;
  }
  const done = op === "=" && ((left.type === "selector_expression" && assignSelector(left, value, offset, st)) || (left.type === "index_expression" && assignIndex(left, value, offset, st)));
  if (!done) lowerExpr(left, st);
}

export function lowerAssignment(n: SyntaxNode, st: GoState): void {
  const op = field(n, "operator")?.text ?? "=";
  const lefts = listOf(field(n, "left"));
  const values = listOf(field(n, "right")).map((v) => lowerExpr(v, st));
  lefts.forEach((left, i) => {
    const value = valueFor(values, lefts.length, i);
    if (value) assignOne(left, value, op, n.endIndex, st);
    else lowerExpr(left, st);
  });
}
