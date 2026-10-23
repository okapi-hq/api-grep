import type { Arg, CallExpr, Entry, Expr, FunctionDef } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { specialCall, specialIndex } from "./calls.js";
import { lowerScalar, lowerString } from "./literals.js";
import { nameRef, posOf, type DartState } from "./names.js";

/**
 * Expressions. The grammar writes a postfix chain flat: `a.b(c)[d]` is the primary `a` followed by sibling `selector`
 * nodes (a member, the arguments of a call, an index), and a cascade (`a..b()..c = 1`) by `cascade_section` siblings.
 * A run is a primary and the selectors after it; a container's named children are read as runs (`runsOf`).
 */

/** What expressions need from the statement lowering (set by lower-stmt.ts). */
export interface ExprHooks {
  closure: (n: SyntaxNode, st: DartState) => FunctionDef;
  assignment: (n: SyntaxNode, st: DartState) => Expr;
  statement: (n: SyntaxNode, st: DartState) => void;
  /** `x.y = v`, `x[k] = v` (a statement or a cascade section), once its target is lowered. */
  memberSet: (target: Expr, value: Expr, offset: number, st: DartState) => void;
}

let hooks: ExprHooks | undefined;
export function setExprHooks(h: ExprHooks): void {
  hooks = h;
}

const SELECTORS = new Set(["selector", "cascade_section", "unconditional_assignable_selector", "conditional_assignable_selector", "argument_part", "index_selector"]);
export const isComment = (n: SyntaxNode): boolean => n.type === "comment" || n.type === "documentation_comment";
const STATEMENTS = new Set(["block", "local_variable_declaration", "expression_statement", "if_statement", "for_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "return_statement"]);

/** Named children as runs: a primary and the selectors after it. Operators and comments are left out. */
export function runsOf(nodes: SyntaxNode[]): SyntaxNode[][] {
  const out: SyntaxNode[][] = [];
  for (const c of nodes) {
    if (isComment(c) || c.type.endsWith("_operator") || c.type === "annotation") continue;
    if (out.length > 0 && SELECTORS.has(c.type)) out.at(-1)!.push(c);
    else out.push([c]);
  }
  return out;
}

const unknown = (n: SyntaxNode): Expr => ({ k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) });

/** The value of the first run of some nodes; the other runs are lowered for their calls. */
export function lowerNodes(nodes: SyntaxNode[], st: DartState): Expr {
  const runs = runsOf(nodes);
  if (runs.length === 0) return { k: "unknown", text: "" };
  const value = lowerRun(runs[0]!, st);
  for (const r of runs.slice(1)) lowerRun(r, st);
  return value;
}

/** Everything under a node, lowered for its calls; the value is unknown. */
export function lowerOther(n: SyntaxNode, st: DartState): Expr {
  for (const r of runsOf(named(n))) {
    if (r.length === 1 && STATEMENTS.has(r[0]!.type)) hooks!.statement(r[0]!, st);
    else lowerRun(r, st);
  }
  return unknown(n);
}

export function lowerArgs(n: SyntaxNode | undefined, st: DartState): Arg[] {
  const args: Arg[] = [];
  for (const a of n ? named(n) : []) {
    if (a.type === "named_argument") {
      const [label, ...rest] = named(a);
      const name = label ? named(label)[0]?.text : undefined;
      if (name) args.push({ name, value: lowerNodes(rest, st) });
    } else if (a.type === "argument") args.push({ value: lowerNodes(named(a), st) });
  }
  return args;
}

/** A call of `fn` with an argument part (`<T>(a, b: c)`); a call the lowering reads as a value is not recorded. */
function callOf(fn: Expr, part: SyntaxNode, start: SyntaxNode, st: DartState): Expr {
  const kids = named(part);
  const args = lowerArgs(kids.find((c) => c.type === "arguments"), st);
  const typeArgs = kids.find((c) => c.type === "type_arguments");
  const call: CallExpr = { k: "call", fn, args, pos: { ...posOf(start), offset: part.startIndex } };
  if (typeArgs) call.typeArgs = runsOf(named(typeArgs)).map((r) => lowerRun(r, st));
  const special = specialCall(call);
  if (special) return special;
  st.fn.calls.push(call);
  return call;
}

function indexOf(obj: Expr, sel: SyntaxNode, st: DartState): Expr {
  const key = lowerNodes(named(sel), st);
  return specialIndex(obj, key) ?? { k: "index", obj, key };
}

/** One selector applied to the value so far. */
function applySelector(e: Expr, s: SyntaxNode, start: SyntaxNode, st: DartState): Expr {
  switch (s.type) {
    case "selector": {
      // `x!` has no named child: the value itself
      const inner = named(s)[0];
      return inner ? applySelector(e, inner, start, st) : e;
    }
    case "unconditional_assignable_selector":
    case "conditional_assignable_selector": {
      const kids = named(s);
      const idx = kids.find((c) => c.type === "index_selector");
      if (idx) return indexOf(e, idx, st);
      const id = kids.find((c) => c.type === "identifier");
      return id ? { k: "attr", obj: e, name: id.text, pos: posOf(id) } : e;
    }
    case "index_selector":
      return indexOf(e, s, st);
    case "argument_part":
      return callOf(e, s, start, st);
    default:
      return e;
  }
}

/** `recv..a(x)..b = v`: each section works on the receiver; the cascade's value is the receiver. */
function lowerCascade(recv: Expr, s: SyntaxNode, st: DartState): void {
  const kids = named(s).filter((c) => !isComment(c));
  const head = kids[0];
  if (!head) return;
  const id = named(head).find((c) => c.type === "identifier");
  const idx = named(head).find((c) => c.type === "index_selector");
  let target: Expr = id ? { k: "attr", obj: recv, name: id.text, pos: posOf(id) } : idx ? indexOf(recv, idx, st) : recv;
  let i = 1;
  for (; i < kids.length && SELECTORS.has(kids[i]!.type); i++) target = applySelector(target, kids[i]!, head, st);
  const rest = kids.slice(i);
  if (rest.length === 0) return;
  const value = lowerNodes(rest, st);
  // a member set on what a call builds, read where that value configures an SDK (`ir/setup.ts`)
  if (recv.k === "call" && target.k === "attr" && target.obj === recv) (recv.sets ??= []).push({ name: target.name, value });
  hooks!.memberSet(target, value, s.endIndex, st);
}

/** A primary and its selectors. */
export function lowerRun(run: SyntaxNode[], st: DartState): Expr {
  const start = run[0]!;
  let e = lowerPrimary(start, st);
  let cascaded = false;
  for (const s of run.slice(1)) {
    if (s.type === "cascade_section") {
      cascaded = true;
      lowerCascade(e, s, st);
    } else if (!cascaded) e = applySelector(e, s, start, st);
  }
  return e;
}

/** `{'a': 1, ...rest, if (c) 'b': 2}`: a map (a set's items as a list); entries under `if` are optional. */
function lowerCollection(n: SyntaxNode, st: DartState): Expr {
  const entries: Entry[] = [];
  const items: Expr[] = [];
  const element = (c: SyntaxNode, optional: boolean): void => {
    if (c.type === "pair") {
      const key = lowerNodes(c.childrenForFieldName("key").filter((x): x is SyntaxNode => !!x), st);
      entries.push({ key, value: lowerNodes(c.childrenForFieldName("value").filter((x): x is SyntaxNode => !!x), st), ...(optional ? { optional } : {}) });
    } else if (c.type === "spread_element") entries.push({ value: lowerNodes(named(c), st), spread: true });
    else if (c.type === "if_element") {
      for (const r of runsOf(named(c))) {
        if (r.length === 1 && (r[0]!.type === "pair" || r[0]!.type === "spread_element")) element(r[0]!, true);
        else lowerRun(r, st);
      }
    }
    else if (c.type === "for_element") lowerOther(c, st);
    else items.push(lowerNodes([c], st));
  };
  for (const r of runsOf(named(n).filter((c) => c.type !== "type_arguments"))) {
    if (r.length === 1) element(r[0]!, false);
    else items.push(lowerRun(r, st));
  }
  return items.length > 0 && entries.length === 0 ? { k: "list", items } : { k: "dict", entries };
}

function lowerList(n: SyntaxNode, st: DartState): Expr {
  const items: Expr[] = [];
  for (const r of runsOf(named(n).filter((c) => c.type !== "type_arguments"))) {
    const c = r[0]!;
    if (r.length === 1 && (c.type === "spread_element" || c.type === "for_element" || c.type === "if_element")) lowerOther(c, st);
    else items.push(lowerRun(r, st));
  }
  return { k: "list", items };
}

/** `a + b + c`: a concatenation when every operator is `+`. */
function lowerAdditive(n: SyntaxNode, st: DartState): Expr {
  const parts = runsOf(named(n)).map((r) => lowerRun(r, st));
  const ops = named(n).filter((c) => c.type === "additive_operator");
  if (ops.some((o) => o.text !== "+")) return unknown(n);
  return { k: "concat", parts: parts.flatMap((p) => (p.k === "concat" ? p.parts : [p])) };
}

/** `c ? a : b`; `a ?? b`. */
function lowerChoice(n: SyntaxNode, st: DartState): Expr {
  const fieldNodes = (name: string): SyntaxNode[] => n.childrenForFieldName(name).filter((x): x is SyntaxNode => !!x);
  if (n.type === "if_null_expression") return { k: "or", left: lowerNodes(fieldNodes("first"), st), right: lowerNodes(fieldNodes("second"), st) };
  const then = fieldNodes("consequence");
  const firstThen = then[0]?.startIndex ?? n.endIndex;
  lowerNodes(named(n).filter((c) => c.endIndex <= firstThen), st);
  return { k: "cond", then: lowerNodes(then, st), else: lowerNodes(fieldNodes("alternative"), st) };
}

/** `new Foo(a)`, `const Foo.named(a)`: a call of the class or its named constructor. */
function lowerNew(n: SyntaxNode, st: DartState): Expr {
  const ids = named(n).filter((c) => c.type === "type_identifier" || c.type === "identifier");
  if (ids.length === 0) return lowerOther(n, st);
  let fn: Expr = nameRef(ids[0]!.text, posOf(ids[0]!), st);
  for (const id of ids.slice(1)) fn = { k: "attr", obj: fn, name: id.text, pos: posOf(id) };
  const call: CallExpr = { k: "call", fn, args: lowerArgs(named(n).find((c) => c.type === "arguments"), st), pos: posOf(n), isNew: true };
  const special = specialCall(call);
  if (special) return special;
  st.fn.calls.push(call);
  return call;
}

/** `switch (x) { A => a, _ => b }`: one of the cases' values, as a Rust `match` is. */
function lowerSwitchExpr(n: SyntaxNode, st: DartState): Expr {
  lowerNodes(field(n, "condition") ? [field(n, "condition")!] : [], st);
  const values = named(n)
    .filter((c) => c.type === "switch_expression_case")
    .map((c) => lowerNodes(named(c).slice(1), st));
  if (values.length === 0) return unknown(n);
  return values.reduceRight((acc, v) => ({ k: "cond", then: v, else: acc, match: true }));
}

function lowerUnary(n: SyntaxNode, st: DartState): Expr {
  const kids = named(n);
  if (kids[0]?.type !== "prefix_operator") return lowerNodes(kids, st);
  const v = lowerNodes(kids.slice(1), st);
  return kids[0].text === "-" && v.k === "num" ? { k: "num", v: -v.v } : unknown(n);
}

function lowerPrimary(n: SyntaxNode, st: DartState): Expr {
  const scalar = lowerScalar(n);
  if (scalar) return scalar;
  switch (n.type) {
    case "identifier":
    case "identifier_dollar_escaped":
    case "type_identifier":
      return nameRef(n.text, posOf(n), st);
    case "this":
    case "super":
      return { k: "this", pos: posOf(n) };
    case "string_literal":
      return lowerString(n, (sub) => lowerNodes(named(sub), st));
    case "list_literal":
      return lowerList(n, st);
    case "set_or_map_literal":
      return lowerCollection(n, st);
    case "parenthesized_expression":
    case "await_expression":
    case "assignable_expression":
      return lowerNodes(named(n), st);
    case "type_cast_expression":
      return lowerNodes(named(n).filter((c) => c.type !== "type_cast"), st);
    case "unary_expression":
      return lowerUnary(n, st);
    case "additive_expression":
      return lowerAdditive(n, st);
    case "conditional_expression":
    case "if_null_expression":
      return lowerChoice(n, st);
    case "new_expression":
    case "const_object_expression":
      return lowerNew(n, st);
    case "function_expression":
      return { k: "fnref", fn: hooks!.closure(n, st) };
    case "switch_expression":
      return lowerSwitchExpr(n, st);
    case "assignment_expression":
      return hooks!.assignment(n, st);
    default:
      return STATEMENTS.has(n.type) ? (hooks!.statement(n, st), unknown(n)) : lowerOther(n, st);
  }
}
