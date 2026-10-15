import type { Expr } from "../ir/model.js";
import { named, type SyntaxNode } from "../tree-sitter.js";

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", "'": "'", '"': '"' };

/** `\n`, `\x41`, `\u{1F600}`; a backslash before a newline skips it and the next line's indentation. */
function unescape(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|\r?\n\s*|.)/g, (m, c: string) => {
    if (c.startsWith("x")) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c.startsWith("u{")) {
      const cp = parseInt(c.slice(2, -1), 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (c.startsWith("\n") || c.startsWith("\r")) return "";
    return ESCAPES[c] ?? m;
  });
}

/** `"a\tb"` with its escapes; `r#"raw"#`, `b"bytes"` and `c"..."` as text. */
function stringValue(n: SyntaxNode): string {
  if (n.type === "raw_string_literal") {
    const content = named(n).find((c) => c.type === "string_content");
    return content ? content.text : n.text.replace(/^[bc]?r#*"/, "").replace(/"#*$/, "");
  }
  return named(n)
    .map((c) => (c.type === "escape_sequence" ? unescape(c.text) : c.text))
    .join("");
}

/** A number without its type suffix (`100u16`, `0.7f32`) or separators. */
function numberValue(text: string): number {
  const clean = text.replace(/_/g, "").replace(/(?:[iu](?:8|16|32|64|128|size)|f32|f64)$/, "");
  const v = /^0[xob]/i.test(clean) ? Number(clean) : parseFloat(clean);
  return Number.isFinite(v) ? v : 0;
}

/** A literal: string, raw string, char, number, boolean; undefined for anything else. */
export function lowerLiteral(n: SyntaxNode): Expr | undefined {
  switch (n.type) {
    case "string_literal":
    case "raw_string_literal":
      return { k: "str", v: stringValue(n) };
    case "char_literal":
      return { k: "str", v: unescape(n.text.replace(/^b?'/, "").replace(/'$/, "")) };
    case "integer_literal":
    case "float_literal":
      return { k: "num", v: numberValue(n.text) };
    case "boolean_literal":
      return { k: "bool", v: n.text === "true" };
    default:
      return undefined;
  }
}
