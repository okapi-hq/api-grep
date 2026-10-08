import type { Part } from "../types.js";

/** The text of parts that are all static; undefined as soon as one part is not. */
export function staticText(parts: Part[]): string | undefined {
  if (parts.every((p) => p.kind === "static")) return parts.map((p) => (p as { text: string }).text).join("");
  return undefined;
}

/** Static text with `{name}` / `{env:NAME}` placeholders. */
export function partsToTemplate(parts: Part[]): string {
  return parts
    .map((p) => (p.kind === "static" ? p.text : p.kind === "env" ? `{env:${p.name}}` : `{${p.name}}`))
    .join("");
}

/** Static parts read through a constant (`const BASE = "https://..."`): the host is `const`, not `literal`. */
export function markConst(parts: Part[]): Part[] {
  return parts.map((p) => (p.kind === "static" ? { ...p, viaConst: true } : p));
}
