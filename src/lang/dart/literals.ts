import type { Expr } from "../ir/model.js";
import type { SyntaxNode } from "../tree-sitter.js";

/**
 * Literals: strings (interpolated, raw, multi-line, and adjacent strings, which Dart concatenates), numbers, booleans
 * and `null`. A string literal node holds its quotes, escapes and `$` substitutions as children; the text between them
 * is the string's own (the grammar does not give it a node).
 */

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };

/** `\n`, `\x41`, `A`, `\u{1F600}`, and `\$`, `\'`, `\\`: any other escaped character is itself. */
export function unescapeDart(text: string): string {
  const c = text.slice(1);
  if (/^x[0-9a-fA-F]{2}$/.test(c)) return String.fromCharCode(parseInt(c.slice(1), 16));
  const u = /^u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))$/.exec(c);
  if (u) {
    const cp = parseInt(u[1] ?? u[2]!, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : text;
  }
  return SIMPLE_ESCAPES[c] ?? c;
}

const OPENING = /^r?('''|"""|'|")$/;

/** Pushes static text, merged into a previous static piece. */
function pushText(parts: Expr[], text: string): void {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.k === "str") parts[parts.length - 1] = { k: "str", v: last.v + text };
  else parts.push({ k: "str", v: text });
}

/** A string literal: its static text, with `$x` / `${...}` substitutions lowered by `interp`. */
export function lowerString(n: SyntaxNode, interp: (sub: SyntaxNode) => Expr): Expr {
  const parts: Expr[] = [];
  const source = n.text;
  let close: string | undefined;
  let cursor = n.startIndex;
  const gap = (to: number): void => pushText(parts, source.slice(cursor - n.startIndex, to - n.startIndex));
  for (const c of n.children) {
    if (!c) continue;
    if (close === undefined) {
      const m = OPENING.exec(c.type);
      if (m) [close, cursor] = [m[1]!, c.endIndex];
      continue;
    }
    gap(c.startIndex);
    cursor = c.endIndex;
    if (c.type === close) close = undefined;
    else if (c.type === "escape_sequence") pushText(parts, unescapeDart(c.text));
    else if (c.type === "template_substitution") parts.push(interp(c));
    // a `$` in a raw string is text
    else pushText(parts, c.text);
  }
  if (parts.length === 0) return { k: "str", v: "" };
  const [only] = parts;
  return parts.length === 1 && only?.k === "str" ? only : { k: "tmpl", parts };
}

function numberValue(text: string): number {
  const clean = text.replace(/_/g, "");
  const v = /^0x/i.test(clean) ? Number(clean) : parseFloat(clean);
  return Number.isFinite(v) ? v : 0;
}

/** A literal other than a string: number, boolean, `null`; undefined for anything else. */
export function lowerScalar(n: SyntaxNode): Expr | undefined {
  switch (n.type) {
    case "decimal_integer_literal":
    case "hex_integer_literal":
    case "decimal_floating_point_literal":
      return { k: "num", v: numberValue(n.text) };
    case "true":
      return { k: "bool", v: true };
    case "false":
      return { k: "bool", v: false };
    case "null_literal":
      return { k: "null" };
    default:
      return undefined;
  }
}
