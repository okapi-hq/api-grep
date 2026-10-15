import type { Arg, Expr } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";
import { jsonValue } from "./json-macro.js";
import { posOf, type RustState } from "./names.js";
import { segmentsOf } from "./paths.js";
import { inMacro } from "./reparse.js";

/**
 * Macros: tree-sitter leaves their arguments as tokens. `format!` (and its kin), `concat!`, `env!` / `option_env!`,
 * `vec!` and `serde_json::json!` are values; the arguments of other macros written like calls are lowered for the
 * calls they hold (`tokio::join!(a(), b())`). Logging and assertion macros send nothing and are skipped.
 */

/** Lowering of an expression node, set by lower-expr.ts. */
let exprHook: ((n: SyntaxNode, st: RustState) => Expr) | undefined;
export function setMacroExprHook(h: (n: SyntaxNode, st: RustState) => Expr): void {
  exprHook = h;
}

const FORMATS = new Set(["format", "format_args"]);
const SKIPPED = new Set([
  "println", "print", "eprintln", "eprint", "write", "writeln", "debug", "info", "warn", "error", "trace", "log", "event", "span",
  "assert", "assert_eq", "assert_ne", "debug_assert", "debug_assert_eq", "debug_assert_ne", "panic", "unreachable", "todo", "unimplemented",
  "macro_rules", "include_str", "include_bytes", "include", "cfg", "matches", "dbg", "compile_error", "bail", "ensure", "anyhow",
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The arguments of a macro written like a call, each lowered; `name = value` is a named argument. */
export function macroArgs(tt: SyntaxNode, st: RustState): Arg[] | undefined {
  return inMacro(tt, st, "args", (nodes) =>
    nodes.map((a): Arg => {
      if (a.type === "assignment_expression" && a.childForFieldName("left")?.type === "identifier") {
        return { name: a.childForFieldName("left")!.text, value: exprHook!(a.childForFieldName("right")!, st) };
      }
      return { value: exprHook!(a, st) };
    }),
  );
}

/** `{name}` placeholders of a format string that no argument gives: identifiers captured from the scope (Rust 2021). */
function captured(template: Expr, args: Arg[], at: SyntaxNode): Arg[] {
  if (template.k !== "str") return [];
  const given = new Set(args.flatMap((a) => (a.name ? [a.name] : [])));
  const out: Arg[] = [];
  for (const m of template.v.matchAll(/\{\{|\{([A-Za-z_][A-Za-z0-9_]*)(?::[^{}]*)?\}/g)) {
    const name = m[1];
    if (name && IDENT.test(name) && !given.has(name) && !out.some((a) => a.name === name)) out.push({ name, value: { k: "name", name, pos: posOf(at) } });
  }
  return out;
}

function formatMacro(args: Arg[], at: SyntaxNode): Expr | undefined {
  const [template, ...rest] = args;
  if (!template || template.name) return undefined;
  return { k: "format", style: "brace", template: template.value, args: [...rest, ...captured(template.value, rest, at)] };
}

function envMacro(args: Arg[]): Expr | undefined {
  const name = args[0]?.value;
  return name?.k === "str" ? { k: "env", name: name.v } : undefined;
}

/** `vec![a, b]` is a list; `vec![x; n]` a list of `x`. */
function vecMacro(tt: SyntaxNode, st: RustState): Expr {
  const repeat = tt.children.some((c) => c?.type === ";");
  if (repeat) return inMacro<Expr>(tt, st, "array", (nodes) => ({ k: "list", items: nodes.slice(0, 1).map((x) => exprHook!(x, st)) })) ?? { k: "list", items: [] };
  return { k: "list", items: (macroArgs(tt, st) ?? []).map((a) => a.value) };
}

/** `lazy_static! { static ref BASE: String = ...; }`: the statics, as items of the file. */
function lazyStatic(tt: SyntaxNode, st: RustState, items: (n: SyntaxNode, st: RustState) => void): void {
  inMacro(tt, st, "items", (nodes) => nodes.forEach((n) => items(n, st)));
}

/** Lowers a macro invocation: its value, or unknown after the calls its arguments make are recorded. */
export function lowerMacro(n: SyntaxNode, st: RustState, items: (n: SyntaxNode, st: RustState) => void): Expr {
  const segs = segmentsOf(n.childForFieldName("macro") ?? undefined) ?? [];
  const name = segs.at(-1) ?? "";
  const tt = named(n).find((c) => c.type === "token_tree");
  const unknown: Expr = { k: "unknown", text: `${name}!`, pos: posOf(n) };
  if (!tt || SKIPPED.has(name)) return unknown;
  if (name === "json") return jsonValue(tt, st);
  if (name === "vec") return vecMacro(tt, st);
  if (name === "lazy_static" || name === "thread_local") {
    lazyStatic(tt, st, items);
    return unknown;
  }
  const opener = tt.text[0];
  if (opener === "{" && !FORMATS.has(name)) return unknown;
  const args = macroArgs(tt, st);
  if (!args) return unknown;
  if (FORMATS.has(name)) return formatMacro(args, n) ?? unknown;
  if (name === "concat") return { k: "concat", parts: args.map((a) => a.value) };
  if (name === "env" || name === "option_env") return envMacro(args) ?? unknown;
  return unknown;
}

