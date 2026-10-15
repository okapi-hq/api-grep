import { MAX_SOURCE_CHARS, type HostLiterals } from "../../hosts/literals.js";
import type { Language } from "../../report/schema.js";
import type { SyntaxNode } from "../tree-sitter.js";

/** Each grammar's string literal nodes: f-strings, interpolated strings, heredocs and raw strings included. */
const STRING_NODES: Partial<Record<Language, string[]>> = {
  python: ["string"],
  php: ["string", "encapsed_string", "heredoc", "nowdoc"],
  kotlin: ["string_literal", "multiline_string_literal"],
  java: ["string_literal"],
  go: ["interpreted_string_literal", "raw_string_literal"],
  // macro arguments are token trees, whose strings are still string literal nodes (`format!("https://…/{x}")`)
  rust: ["string_literal", "raw_string_literal"],
};

/** A Python string that is a statement of its own: a docstring, or text commented out. */
const isDocstring = (n: SyntaxNode, language: Language): boolean => language === "python" && n.parent?.type === "expression_statement" && n.parent.namedChildCount === 1;

/**
 * Hands the string literals of a parsed file to `hosts`, at their first line. Comments are not string nodes; a string
 * inside another's interpolation is read as part of the outer one.
 */
export function collectHostLiterals(root: SyntaxNode, language: Language, file: string, hosts: HostLiterals): void {
  const types = STRING_NODES[language];
  if (!types || root.endIndex > MAX_SOURCE_CHARS) return;
  let end = -1;
  for (const n of root.descendantsOfType(types)) {
    if (!n || n.startIndex < end || isDocstring(n, language)) continue;
    end = n.endIndex;
    const text = n.text;
    if (text.includes(".")) hosts.add(text, file, n.startPosition.row + 1, language);
  }
}
