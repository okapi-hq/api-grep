import type { Expr } from "../ir/model.js";

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
