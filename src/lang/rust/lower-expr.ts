import { markBranches, type BranchSyntax } from "../branches.js";
import type { Arg, CallExpr, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { specialCall, type Hooks } from "./calls.js";
import { setJsonExprHook } from "./json-macro.js";
import { lowerLiteral } from "./literals.js";
import { lowerMacro, setMacroExprHook } from "./macros.js";
import { posOf, type RustState } from "./names.js";
import { pathExpr, segmentsOf } from "./paths.js";
import { lowerStructExpr } from "./struct-expr.js";

export const RUST_BRANCHES: BranchSyntax = {
  ifStatement: "if_expression",
  then: "consequence",
  elseClause: "else_clause",
  loops: new Set(["for_expression", "while_expression", "loop_expression"]),
  clauses: new Set(["match_arm"]),
};

export function newFunction(name: string, mod: ModuleModel, n: SyntaxNode, extra: Partial<FunctionDef> = {}): FunctionDef {
  return { name, params: [], assigns: [], returns: [], calls: [], module: mod, pos: posOf(n), ...extra };
}

/** What expressions need from statement lowering (blocks, closures, items in macros); set by lower.ts. */
export interface StatementHooks {
  /** Lowers a block's statements; its value is its trailing expression. */
  block: (n: SyntaxNode, st: RustState) => Expr;
  closure: (n: SyntaxNode, st: RustState) => FunctionDef;
  /** Binds a pattern's variable to a value (`if let Some(x) = v`, `Ok(key) => key`). */
  bind: (pattern: SyntaxNode | undefined, value: Expr, offset: number, st: RustState) => void;
  item: (n: SyntaxNode, st: RustState) => void;
}

let hooks: StatementHooks | undefined;
export function setStatementHooks(h: StatementHooks): void {
  hooks = h;
}

export function record(call: CallExpr, st: RustState): CallExpr {
  st.fn.calls.push(call);
  return call;
}

export function lowerArgs(n: SyntaxNode | undefined, st: RustState): Arg[] {
  return (n ? named(n) : []).filter((a) => !a.type.endsWith("comment") && a.type !== "attribute_item").map((a) => ({ value: lowerExpr(a, st) }));
}

/** The value a closure gives, lowered in the current function (`unwrap_or_else(|_| "d".into())`). */
function closureValue(n: SyntaxNode, st: RustState): Expr {
  const body = field(n, "body");
  if (!body) return { k: "unknown", text: "closure" };
  return body.type === "block" ? hooks!.block(body, st) : lowerExpr(body, st);
}

const HOOKS: Hooks = { expr: (n, st) => lowerExpr(n, st), args: (n, st) => lowerArgs(n, st), closureValue };

function lowerCall(n: SyntaxNode, st: RustState): Expr {
  const special = specialCall(n, st, HOOKS);
  if (special) return special;
  let fnNode = field(n, "function")!;
  if (fnNode.type === "generic_function") fnNode = field(fnNode, "function") ?? fnNode;
  const fn = lowerExpr(fnNode, st);
  return record({ k: "call", fn, args: lowerArgs(field(n, "arguments"), st), pos: posOf(n) }, st);
}

function lowerBinary(n: SyntaxNode, st: RustState): Expr {
  const op = field(n, "operator")?.text;
  const left = lowerExpr(field(n, "left")!, st);
  const right = lowerExpr(field(n, "right")!, st);
  if (op === "+") return { k: "concat", parts: [...(left.k === "concat" ? left.parts : [left]), right] };
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

/** `if c { a } else { b }`: one of its values; `if let Some(x) = v` binds `x` in the first block. */
function lowerIf(n: SyntaxNode, st: RustState): Expr {
  markBranches(n, st.fn, RUST_BRANCHES);
  const cond = field(n, "condition");
  if (cond?.type === "let_condition") hooks!.bind(field(cond, "pattern"), lowerExpr(field(cond, "value")!, st), cond.endIndex, st);
  else if (cond) lowerExpr(cond, st);
  const then = field(n, "consequence");
  const thenValue = then ? hooks!.block(then, st) : ({ k: "unknown", text: "if" } as Expr);
  const alt = field(n, "alternative");
  const inner = alt ? named(alt)[0] : undefined;
  if (!inner) return { k: "unknown", text: "if", pos: posOf(n) };
  const elseValue = inner.type === "block" ? hooks!.block(inner, st) : lowerExpr(inner, st);
  return { k: "cond", then: thenValue, else: elseValue };
}

/** `match v { A => a, _ => b }`: one of the arms' values; `Some(x) => x` binds `x` to `v` in its arm. */
function lowerMatch(n: SyntaxNode, st: RustState): Expr {
  const value = lowerExpr(field(n, "value")!, st);
  const body = field(n, "body");
  const values: Expr[] = [];
  for (const arm of body ? named(body).filter((c) => c.type === "match_arm") : []) {
    markBranches(arm, st.fn, RUST_BRANCHES);
    const pattern = field(arm, "pattern");
    hooks!.bind(pattern ? named(pattern)[0] : undefined, value, arm.startIndex, st);
    const v = field(arm, "value");
    if (v) values.push(v.type === "block" ? hooks!.block(v, st) : lowerExpr(v, st));
  }
  if (values.length === 0) return { k: "unknown", text: "match", pos: posOf(n) };
  return values.reduceRight((acc, v) => ({ k: "cond", then: v, else: acc }));
}

function lowerIdentifier(n: SyntaxNode, st: RustState): Expr {
  if (n.text === "self") return { k: "this", pos: posOf(n) };
  if (n.text === "None" && !st.locals.has("None")) return { k: "null" };
  return { k: "name", name: n.text, pos: posOf(n) };
}

/** Expressions that stand for their operand: `&x`, `*x`, `(x)`, `x?`, `x.await`, `x as T`, `-` aside. */
function operandOf(n: SyntaxNode): SyntaxNode | undefined {
  switch (n.type) {
    case "reference_expression":
      return field(n, "value");
    case "unary_expression":
      return n.child(0)?.type === "*" ? named(n)[0] : undefined;
    case "parenthesized_expression":
    case "try_expression":
    case "await_expression":
      return named(n).find((c) => !c.type.endsWith("comment"));
    case "type_cast_expression":
      return field(n, "value");
    default:
      return undefined;
  }
}

function lowerUnary(n: SyntaxNode, st: RustState): Expr {
  const operand = named(n)[0];
  const v = operand ? lowerExpr(operand, st) : undefined;
  if (n.child(0)?.type === "-" && v?.k === "num") return { k: "num", v: -v.v };
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

/** Lowers a Rust expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: RustState): Expr {
  const lit = lowerLiteral(n);
  if (lit) return lit;
  const operand = operandOf(n);
  if (operand) return lowerExpr(operand, st);
  switch (n.type) {
    case "identifier":
    case "self":
      return lowerIdentifier(n, st);
    case "scoped_identifier":
      return pathExpr(segmentsOf(n) ?? [n.text], n, st);
    case "field_expression":
      return { k: "attr", obj: lowerExpr(field(n, "value")!, st), name: field(n, "field")!.text, pos: posOf(field(n, "field")!) };
    case "call_expression":
      return lowerCall(n, st);
    case "macro_invocation":
      return lowerMacro(n, st, hooks!.item);
    case "struct_expression":
      return lowerStructExpr(n, st, lowerExpr);
    case "binary_expression":
      return lowerBinary(n, st);
    case "unary_expression":
      return lowerUnary(n, st);
    case "index_expression": {
      const [obj, key] = named(n);
      return obj && key ? { k: "index", obj: lowerExpr(obj, st), key: lowerExpr(key, st) } : lowerOther(n, st);
    }
    case "array_expression":
    case "tuple_expression":
      return { k: "list", items: named(n).filter((c) => !c.type.endsWith("comment") && c.type !== "attribute_item").map((c) => lowerExpr(c, st)) };
    case "closure_expression":
      return { k: "fnref", fn: hooks!.closure(n, st) };
    default:
      return lowerControl(n, st);
  }
}

/** Blocks, conditionals, `match`, `return` and loops; anything else is lowered for its calls. */
function lowerControl(n: SyntaxNode, st: RustState): Expr {
  switch (n.type) {
    case "block":
    case "unsafe_block":
    case "async_block":
    case "const_block":
      return hooks!.block(n.type === "block" ? n : (named(n).find((c) => c.type === "block") ?? n), st);
    case "if_expression":
      return lowerIf(n, st);
    case "match_expression":
      return lowerMatch(n, st);
    case "return_expression": {
      const value = named(n).find((c) => !c.type.endsWith("comment"));
      if (value) st.fn.returns.push(lowerExpr(value, st));
      return { k: "unknown", text: "return", pos: posOf(n) };
    }
    default:
      if (RUST_BRANCHES.loops.has(n.type)) markBranches(n, st.fn, RUST_BRANCHES);
      return lowerOther(n, st);
  }
}

/** Anything else still has its calls recorded. */
export function lowerOther(n: SyntaxNode, st: RustState): Expr {
  for (const c of named(n)) if (!c.type.endsWith("comment")) lowerExpr(c, st);
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

setMacroExprHook(lowerExpr);
setJsonExprHook(lowerExpr);
