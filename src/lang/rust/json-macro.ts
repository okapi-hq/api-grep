import type { Entry, Expr } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { lowerLiteral } from "./literals.js";
import { posOf, type RustState } from "./names.js";
import { withParsed } from "./reparse.js";

/**
 * `serde_json::json!({ "model": model, "messages": [{ "role": "user", "content": prompt }] })`: the JSON value the
 * macro builds, read from its tokens. Objects and arrays are token trees; a value that is Rust code (`self.model`,
 * `format!(...)`) is parsed again as an expression.
 */

/** Lowering of an expression node, set by lower-expr.ts. */
let exprHook: ((n: SyntaxNode, st: RustState) => Expr) | undefined;
export function setJsonExprHook(h: (n: SyntaxNode, st: RustState) => Expr): void {
  exprHook = h;
}

const MAX_DEPTH = 16;

const tokensOf = (tt: SyntaxNode): SyntaxNode[] => tt.children.slice(1, -1).filter((c): c is SyntaxNode => !!c && c.type !== "line_comment" && c.type !== "block_comment");

/** Tokens split on the commas between them (a token tree is one token: commas inside it do not split). */
function splitOn(tokens: SyntaxNode[], sep: string): SyntaxNode[][] {
  const out: SyntaxNode[][] = [[]];
  for (const t of tokens) {
    if (t.type === sep) out.push([]);
    else out.at(-1)!.push(t);
  }
  return out.filter((p) => p.length > 0);
}

/** Rust code between two tokens of a token tree, parsed as one expression. */
function code(tokens: SyntaxNode[], tt: SyntaxNode, st: RustState): Expr {
  const first = tokens[0]!;
  const text = tt.text.slice(first.startIndex - tt.startIndex, tokens.at(-1)!.endIndex - tt.startIndex);
  return withParsed(text, first, 0, "expr", st, (nodes) => (nodes[0] ? exprHook!(nodes[0], st) : undefined)) ?? { k: "unknown", text: text.slice(0, 80), pos: posOf(first) };
}

function object(tt: SyntaxNode, st: RustState, depth: number): Expr {
  const entries: Entry[] = [];
  for (const part of splitOn(tokensOf(tt), ",")) {
    const colon = part.findIndex((t) => t.type === ":");
    if (colon <= 0 || colon === part.length - 1) continue;
    const keyTokens = part.slice(0, colon);
    const key = keyTokens.length === 1 ? (lowerLiteral(keyTokens[0]!) ?? code(keyTokens, tt, st)) : code(keyTokens, tt, st);
    entries.push({ key, value: value(part.slice(colon + 1), tt, st, depth + 1) });
  }
  return { k: "dict", entries };
}

function value(tokens: SyntaxNode[], tt: SyntaxNode, st: RustState, depth: number): Expr {
  if (depth > MAX_DEPTH) return { k: "unknown", text: "json" };
  const only = tokens.length === 1 ? tokens[0]! : undefined;
  if (only?.type === "token_tree") {
    const open = only.text[0];
    if (open === "{") return object(only, st, depth);
    if (open === "[") return { k: "list", items: splitOn(tokensOf(only), ",").map((p) => value(p, only, st, depth + 1)) };
    return value(tokensOf(only), only, st, depth + 1);
  }
  if (only?.type === "identifier" && only.text === "null") return { k: "null" };
  const literal = only ? lowerLiteral(only) : undefined;
  return literal ?? code(tokens, tt, st);
}

/** The value of a `json!(...)` invocation, from its token tree. */
export function jsonValue(tt: SyntaxNode, st: RustState): Expr {
  const tokens = tokensOf(tt);
  return tokens.length > 0 ? value(tokens, tt, st, 0) : { k: "null" };
}
