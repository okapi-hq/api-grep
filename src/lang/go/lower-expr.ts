import type { Arg, CallExpr, Expr, FunctionDef, ModuleModel } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { lowerComposite } from "./composite.js";
import { packageOf, posOf, type GoState } from "./names.js";
import { packageCall } from "./package-calls.js";

export function newFunction(name: string, mod: ModuleModel, n: SyntaxNode, extra: Partial<FunctionDef> = {}): FunctionDef {
  return { name, params: [], assigns: [], returns: [], calls: [], module: mod, pos: posOf(n), ...extra };
}

/** Statement-level lowering expressions need (function literals); set by lower.ts. */
let closureHook: ((n: SyntaxNode, st: GoState) => FunctionDef) | undefined;
export function setClosureHook(h: (n: SyntaxNode, st: GoState) => FunctionDef): void {
  closureHook = h;
}

const ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"' };

function unescape(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{3}|.)/g, (m, c: string) => {
    if (/^[xuU]/.test(c)) return String.fromCodePoint(parseInt(c.slice(1), 16));
    if (/^[0-7]{3}$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ESCAPES[c] ?? m;
  });
}

/** `"a\tb"` with its escapes, `` `raw` `` as written (carriage returns dropped, as Go does). */
export function lowerString(n: SyntaxNode): Expr {
  if (n.type === "raw_string_literal") return { k: "str", v: n.text.slice(1, -1).replace(/\r/g, "") };
  if (n.type === "rune_literal") return { k: "str", v: unescape(n.text.slice(1, -1)) };
  return { k: "str", v: named(n).map((c) => (c.type === "escape_sequence" ? unescape(c.text) : c.text)).join("") };
}

/** `xs...` is a spread; `option.WithBaseURL(u)` a functional option, an argument named like its option (`kw:WithBaseURL`). */
function lowerArg(a: SyntaxNode, st: GoState): Arg {
  if (a.type === "variadic_argument") return { value: lowerExpr(named(a)[0]!, st), spread: "list" };
  const fnNode = a.type === "call_expression" ? field(a, "function") : undefined;
  const operand = fnNode?.type === "selector_expression" ? field(fnNode, "operand") : undefined;
  const option = fnNode && operand?.type === "identifier" && packageOf(operand.text, st) ? field(fnNode, "field")?.text : undefined;
  const inner = option?.startsWith("With") ? named(field(a, "arguments")!) : [];
  if (option && inner.length === 1 && inner[0]!.type !== "variadic_argument") return { name: option, value: lowerExpr(inner[0]!, st) };
  return { value: lowerExpr(a, st) };
}

export function lowerArgs(n: SyntaxNode | undefined, st: GoState): Arg[] {
  return (n ? named(n) : []).filter((a) => a.type !== "comment").map((a) => lowerArg(a, st));
}

export function record(call: CallExpr, st: GoState): CallExpr {
  st.fn.calls.push(call);
  return call;
}

/** Conversions written like calls: `string(b)`, `[]byte(s)` are their operand. */
const CONVERSIONS = new Set(["string", "byte", "rune"]);

function lowerCall(n: SyntaxNode, st: GoState): Expr {
  const fnNode = field(n, "function")!;
  const argsNode = field(n, "arguments");
  const first = argsNode ? named(argsNode)[0] : undefined;
  if (fnNode.type === "identifier" && CONVERSIONS.has(fnNode.text) && !st.locals.has(fnNode.text) && first) return lowerExpr(first, st);
  const special = packageCall(fnNode, argsNode, st);
  if (special?.value) return special.value;
  const fn = lowerExpr(fnNode, st);
  return record({ k: "call", fn, args: special?.args ?? lowerArgs(argsNode, st), pos: posOf(n) }, st);
}

/** `pkg.Name` and `x.field`; `http.DefaultClient` is the client a composite literal `http.Client{}` makes. */
function lowerSelector(n: SyntaxNode, st: GoState): Expr {
  const operand = field(n, "operand")!;
  const name = field(n, "field")!;
  if (operand.type === "identifier" && name.text === "DefaultClient" && packageOf(operand.text, st) === "net/http") {
    return { k: "call", fn: { k: "attr", obj: { k: "name", name: operand.text, pos: posOf(operand) }, name: "Client", pos: posOf(name) }, args: [], pos: posOf(n), isNew: true };
  }
  return { k: "attr", obj: lowerExpr(operand, st), name: name.text, pos: posOf(name) };
}

function lowerBinary(n: SyntaxNode, st: GoState): Expr {
  const op = field(n, "operator")?.text;
  const left = lowerExpr(field(n, "left")!, st);
  const right = lowerExpr(field(n, "right")!, st);
  if (op === "+") return { k: "concat", parts: [...(left.k === "concat" ? left.parts : [left]), right] };
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}

function lowerIdentifier(n: SyntaxNode, st: GoState): Expr {
  if (st.receiver && n.text === st.receiver) return { k: "this", pos: posOf(n) };
  return { k: "name", name: n.text, pos: posOf(n) };
}

function lowerLiteral(n: SyntaxNode): Expr | undefined {
  switch (n.type) {
    case "int_literal":
    case "float_literal": {
      const v = Number(n.text.replace(/_/g, ""));
      return { k: "num", v: Number.isFinite(v) ? v : 0 };
    }
    case "true":
    case "false":
      return { k: "bool", v: n.type === "true" };
    case "nil":
      return { k: "null" };
    case "interpreted_string_literal":
    case "raw_string_literal":
    case "rune_literal":
      return lowerString(n);
    default:
      return undefined;
  }
}

/** Expressions that stand for their operand: `&x`, `*p`, `(x)`, `x.(T)`, `T(x)`. */
function operandOf(n: SyntaxNode): SyntaxNode | undefined {
  if (n.type === "unary_expression") return ["&", "*"].includes(field(n, "operator")?.text ?? "") ? field(n, "operand") : undefined;
  if (n.type === "parenthesized_expression") return named(n).find((c) => c.type !== "comment");
  if (n.type === "type_assertion_expression" || n.type === "type_conversion_expression") return field(n, "operand");
  return undefined;
}

/** Lowers a Go expression; calls are recorded in the current function as they are met. */
export function lowerExpr(n: SyntaxNode, st: GoState): Expr {
  const lit = lowerLiteral(n);
  if (lit) return lit;
  const operand = operandOf(n);
  if (operand) return lowerExpr(operand, st);
  switch (n.type) {
    case "identifier":
      return lowerIdentifier(n, st);
    case "selector_expression":
      return lowerSelector(n, st);
    case "call_expression":
      return lowerCall(n, st);
    case "composite_literal":
      return lowerComposite(n, st);
    case "binary_expression":
      return lowerBinary(n, st);
    case "index_expression":
      return { k: "index", obj: lowerExpr(field(n, "operand")!, st), key: lowerExpr(field(n, "index")!, st) };
    case "func_literal":
      return closureHook ? { k: "fnref", fn: closureHook(n, st) } : { k: "unknown", text: "func" };
    default:
      return lowerOther(n, st);
  }
}

/** Anything else still has its calls recorded. */
export function lowerOther(n: SyntaxNode, st: GoState): Expr {
  for (const c of named(n)) if (c.type !== "comment") lowerExpr(c, st);
  return { k: "unknown", text: n.text.slice(0, 80), pos: posOf(n) };
}
