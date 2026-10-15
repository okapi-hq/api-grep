import { Parser } from "web-tree-sitter";
import { named, type SyntaxNode } from "../tree-sitter.js";
import { posOf, SHIFT, type RustFile, type RustState } from "./names.js";

/**
 * Macro arguments are parsed again as Rust: tree-sitter keeps a macro's input as tokens. The snippet wraps the text so
 * it parses as call arguments, an array, items or one expression; while its nodes are lowered, `SHIFT` maps their
 * positions back to the file (the snippet's first line starts after the wrapper's prefix).
 */

type Kind = "args" | "array" | "items" | "expr";

const WRAP: Record<Kind, [string, string]> = {
  args: ["fn _f(){_m(", ");}"],
  array: ["fn _f(){[", "];}"],
  items: ["", ""],
  expr: ["fn _f(){(", ");}"],
};

/** Bounds a snippet: a macro's input is code of the file, but one larger than this is generated data, not a request. */
const MAX_TEXT = 64 * 1024;

/** The parser of a file's grammar, made on first use; the scan's own is busy with the file. */
export function fileParser(root: SyntaxNode): () => Parser | undefined {
  let parser: Parser | undefined;
  return () => {
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(root.tree.language);
    }
    return parser;
  };
}

export function deleteParser(file: RustFile): void {
  file.parser?.delete();
}

function nodesOf(root: SyntaxNode, kind: Kind): SyntaxNode[] | undefined {
  if (kind === "items") return named(root).filter((c) => c.type !== "line_comment" && c.type !== "block_comment");
  const body = named(root)[0]?.childForFieldName("body");
  const stmt = body ? named(body)[0] : undefined;
  const value = stmt?.type === "expression_statement" ? named(stmt)[0] : stmt;
  if (kind === "expr") return value?.type === "parenthesized_expression" ? named(value).slice(0, 1) : undefined;
  if (kind === "array") return value?.type === "array_expression" ? named(value).slice(0, 1) : undefined;
  const args = value?.type === "call_expression" ? value.childForFieldName("arguments") : undefined;
  return args ? named(args).filter((c) => c.type !== "line_comment" && c.type !== "block_comment" && c.type !== "attribute_item") : undefined;
}

/**
 * Parses `text`, written in the file at `at`'s position (plus `delta` characters on its line), as `kind`, and runs `f`
 * on its nodes with their positions mapped to the file; undefined when it does not parse. The snippet's tree is
 * deleted after `f`: a lowered expression holds no node.
 */
export function withParsed<T>(text: string, at: SyntaxNode, delta: number, kind: Kind, st: RustState, f: (nodes: SyntaxNode[]) => T): T | undefined {
  const parser = text.length <= MAX_TEXT ? st.file.parserFor() : undefined;
  if (!parser) return undefined;
  const [open, close] = WRAP[kind];
  const source = kind === "items" ? text.replace(/\bstatic\s+ref\b/g, (m) => `static${" ".repeat(m.length - 6)}`) : `${open}${text}${close}`;
  const tree = parser.parse(source);
  try {
    const nodes = tree && !tree.rootNode.hasError ? nodesOf(tree.rootNode, kind) : undefined;
    if (!nodes) return undefined;
    const pos = posOf(at);
    const saved = { ...SHIFT };
    Object.assign(SHIFT, { active: true, offset: pos.offset + delta, row: pos.line - 1, col: pos.col - 1 + delta, prefix: open.length });
    try {
      return f(nodes);
    } finally {
      Object.assign(SHIFT, saved);
    }
  } finally {
    tree?.delete();
  }
}

/** The input of a macro (`(...)`, `[...]` or `{...}`) as `kind`, lowered by `f`. */
export function inMacro<T>(tt: SyntaxNode, st: RustState, kind: Kind, f: (nodes: SyntaxNode[]) => T): T | undefined {
  return tt.text.length < 2 ? undefined : withParsed(tt.text.slice(1, -1), tt, 1, kind, st, f);
}
