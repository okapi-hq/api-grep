import { staticText } from "../../resolve/parts.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { wordParts, type WordCtx } from "./words.js";

/** A `case` or `[[ x == pattern ]]` pattern (`get|GET`, `post*`) as a test of a known value. */
function matches(pattern: string, value: string): boolean {
  const re = pattern.replace(/[.+^${}()\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^(?:${re})$`, "s").test(value);
}

const known = (node: SyntaxNode | null | undefined, ctx: WordCtx): string | undefined => (node ? staticText(wordParts(node, ctx)) : undefined);

/** `[ "$1" = get ]`, `[[ $1 == "head" ]]`, `!=`: true or false when both sides are known, else undefined. */
function testValue(cond: SyntaxNode | undefined, ctx: WordCtx): boolean | undefined {
  const e = cond?.type === "test_command" ? cond.namedChildren[0] : undefined;
  if (e?.type !== "binary_expression") return undefined;
  const op = e.childForFieldName("operator")?.type;
  if (op !== "=" && op !== "==" && op !== "!=") return undefined;
  const left = known(e.childForFieldName("left"), ctx);
  const right = known(e.childForFieldName("right"), ctx);
  if (left === undefined || right === undefined) return undefined;
  return matches(right, left) !== (op === "!=");
}

function conditionOf(clause: SyntaxNode): SyntaxNode | undefined {
  if (clause.type === "if_statement") return clause.childrenForFieldName("condition").filter((c): c is SyntaxNode => !!c?.isNamed).pop();
  return clause.namedChildren.find((c): c is SyntaxNode => !!c && c.type !== "comment") ?? undefined;
}

/** Whether the branch of an `if` holding `child` runs: its test is not false and no test before it is true. */
function ifTaken(stmt: SyntaxNode, child: SyntaxNode, ctx: WordCtx): boolean {
  const clauses = [stmt, ...stmt.namedChildren.filter((c): c is SyntaxNode => c?.type === "elif_clause" || c?.type === "else_clause")];
  const own = child.type === "elif_clause" || child.type === "else_clause" ? child : stmt;
  // a command in a test runs whatever the test gives (`if curl -fsS ...; then`)
  if (clauses.some((c) => c.type !== "else_clause" && conditionOf(c)?.startIndex === child.startIndex)) return true;
  for (const c of clauses) {
    const value = c.type === "else_clause" ? true : testValue(conditionOf(c), ctx);
    if (c.startIndex === own.startIndex) return value !== false;
    if (value === true) return false;
  }
  return true;
}

function caseTaken(item: SyntaxNode, ctx: WordCtx): boolean {
  const stmt = item.parent!;
  const value = known(stmt.childForFieldName("value"), ctx);
  if (value === undefined) return true;
  const items = stmt.namedChildren.filter((c): c is SyntaxNode => c?.type === "case_item");
  const taken = items.find((i) => i.childrenForFieldName("value").some((p) => !!p && matches(p.text, value)));
  return taken?.startIndex === item.startIndex;
}

/**
 * Whether a wrapper's call site reaches a command of the wrapper: a `case "$1" in get) ...` or an
 * `if [[ "$1" = get ]]` around it is decided by the arguments the call gives (`http_request get "$url"` runs the `get`
 * branch only); a test the scan cannot read takes every branch.
 */
export function branchTaken(cmd: SyntaxNode, ctx: WordCtx): boolean {
  let child = cmd;
  for (let n = cmd.parent; n && n.type !== "function_definition"; child = n, n = n.parent) {
    if (n.type === "case_item" && n.parent?.type === "case_statement" && !caseTaken(n, ctx)) return false;
    if (n.type === "if_statement" && !ifTaken(n, child, ctx)) return false;
  }
  return true;
}
