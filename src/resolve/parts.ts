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

/**
 * `s.replace("{basin}", basin)`: the literal `needle` swapped for `replacement` in the static text, the first match or
 * all of them. Dynamic parts stay as they are: what they hold is unknown.
 */
export function replaceInParts(parts: Part[], needle: string, replacement: Part[], all: boolean): Part[] {
  if (!needle) return parts;
  let done = false;
  return parts.flatMap((p): Part[] => {
    if (p.kind !== "static" || (done && !all) || !p.text.includes(needle)) return [p];
    done = true;
    const at = p.text.indexOf(needle);
    const pieces = all ? p.text.split(needle) : [p.text.slice(0, at), p.text.slice(at + needle.length)];
    return pieces.flatMap((piece, i) => [...(i ? replacement : []), ...(piece ? [{ ...p, text: piece }] : [])]);
  });
}

/** A literal scheme and host leading the parts (`https://api.example.com/...`). */
export function hasStaticHost(parts: Part[]): boolean {
  const first = parts[0];
  return first?.kind === "static" && /^[a-z][a-z0-9+.-]*:\/\/[^/?#{]+/i.test(first.text);
}

/** An env var or a scheme leading the parts (`${process.env.API_URL}/v1`, `https://${host}/v1`). */
function leadsWithBase(parts: Part[]): boolean {
  const first = parts[0];
  return first?.kind === "env" || (first?.kind === "static" && /^[a-z][a-z0-9+.-]*:\/\//i.test(first.text));
}

/**
 * `cond ? A : B`: two static values read as the first (a constant choice); else the first branch with a literal host
 * (`cloud ? "https://api..." : selfHostedUrl`), then one led by an env var or a scheme; else an empty branch
 * (`port ? ":" + port : ""` reads as no port) or a static one beside a branch that does not start unknown (a relative
 * path chosen over `${base}/...` would make the call `internal`). The best static guess, as for `x ?? "default"`.
 */
export function pickBranch(a: Part[], b: Part[]): Part[] | undefined {
  if (staticText(a) !== undefined && staticText(b) !== undefined) return markConst(a);
  const branches = [a, b];
  const quiet = (p: Part[], other: Part[]): boolean => staticText(p) === "" || (staticText(p) !== undefined && other[0]?.kind === "static");
  return branches.find(hasStaticHost) ?? branches.find(leadsWithBase) ?? (quiet(a, b) ? a : quiet(b, a) ? b : undefined);
}

/** Static parts read through a constant (`const BASE = "https://..."`): the host is `const`, not `literal`. */
export function markConst(parts: Part[]): Part[] {
  return parts.map((p) => (p.kind === "static" ? { ...p, viaConst: true } : p));
}
