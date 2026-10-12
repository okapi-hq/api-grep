import type { Expr } from "../ir/model.js";

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", "\\": "\\", "'": "'", '"': '"', $: "$" };

/** `\n`, `\$`, `A`. */
export function unescapeKotlin(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, c: string) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (ESCAPES[c] ?? m)));
}

/** `'a'`, `'\n'`. */
export function charValue(text: string): string {
  return unescapeKotlin(text.slice(1, -1));
}

/** `1_000L`, `0x1F`, `10u`, `1.5f`. */
export function numberValue(text: string): number {
  const t = text.replace(/_/g, "").replace(/(?:[uU][lL]?|[lL])$/, "");
  const v = /^0[xb]/i.test(t) ? Number(t) : Number.parseFloat(t.replace(/[fF]$/, ""));
  return Number.isFinite(v) ? v : 0;
}

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u;

/**
 * The grammar splits a short template (`"$base/v1"`) into a `$` piece and the text after it: the identifier at the
 * start of that text is the interpolated name. Undefined when the text does not start with one (`"$ 5"`, `"$"`).
 */
export function shortTemplate(next: string): { name: string; rest: string } | undefined {
  const m = IDENT.exec(next);
  return m ? { name: m[0], rest: next.slice(m[0].length) } : undefined;
}

/**
 * Spring placeholders (`@Value("\${api.url:https://x}")`): each `${key}` / `${key:default}` is a configuration read,
 * with its default; the text around them stays.
 */
export function springPlaceholders(text: string): Expr {
  const parts: Expr[] = [];
  let last = 0;
  for (const m of text.matchAll(/\$\{([^}:]+)(?::([^}]*))?\}/g)) {
    if (m.index > last) parts.push({ k: "str", v: text.slice(last, m.index) });
    parts.push({ k: "env", name: m[1]!.trim(), ...(m[2] ? { fallback: { k: "str", v: m[2] } } : {}) });
    last = m.index + m[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ k: "str", v: text.slice(last) });
  return parts.length === 1 ? parts[0]! : { k: "tmpl", parts };
}
