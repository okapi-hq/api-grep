import { MAX_SOURCE_CHARS, type HostLiterals } from "../../hosts/literals.js";
import type { Language } from "../../report/schema.js";
import type { SyntaxNode } from "../tree-sitter.js";
import { literalRole } from "./host-context.js";

/** Each grammar's string literal nodes: f-strings, interpolated strings, heredocs and raw strings included. */
const STRING_NODES: Partial<Record<Language, string[]>> = {
  python: ["string"],
  php: ["string", "encapsed_string", "heredoc", "nowdoc"],
  kotlin: ["string_literal", "multiline_string_literal"],
  java: ["string_literal"],
  go: ["interpreted_string_literal", "raw_string_literal"],
  // macro arguments are token trees, whose strings are still string literal nodes (`format!("https://…/{x}")`)
  rust: ["string_literal", "raw_string_literal"],
  dart: ["string_literal"],
};

/** A Python string that is a statement of its own: a docstring, or text commented out. */
const isDocstring = (n: SyntaxNode, language: Language): boolean => language === "python" && n.parent?.type === "expression_statement" && n.parent.namedChildCount === 1;

/** Character ranges of a file's own test code (Rust's `#[cfg(test)]` modules and `#[test]` functions), sorted. */
export type TestRanges = Array<[start: number, end: number]>;

/**
 * Hands the string literals of a parsed file to `hosts`, at their first line, each with its role (`host-context.ts`:
 * a log's text, a link's value). Comments are not string nodes; a string inside another's interpolation is read as
 * part of the outer one; strings in `tests` are not read.
 */
export function collectHostLiterals(root: SyntaxNode, language: Language, file: string, hosts: HostLiterals, tests: TestRanges = []): void {
  const types = STRING_NODES[language];
  if (!types || root.endIndex > MAX_SOURCE_CHARS) return;
  let end = -1;
  let t = 0;
  for (const n of root.descendantsOfType(types)) {
    if (!n || n.startIndex < end || isDocstring(n, language)) continue;
    end = n.endIndex;
    while (t < tests.length && tests[t]![1] <= n.startIndex) t++;
    if (t < tests.length && tests[t]![0] <= n.startIndex) continue;
    const text = n.text;
    if (text.includes(".")) hosts.add(text, file, n.startPosition.row + 1, language, literalRole(n, language));
  }
}
