const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[a-z]{1,6}_[A-Za-z0-9]{8,}|[0-9a-f]{16,})$/i;

/** `{name}` placeholders of a path or URL template. Global: use it with `matchAll` / `replace`, not `exec`. */
export const PLACEHOLDER_RE = /\{([^}]+)\}/g;

/** Scheme of an absolute URL (`https://`, `wss://`). */
export const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

/** Names of the `{name}` placeholders of a template, in order. */
export function placeholderNames(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

export function firstPlaceholder(text: string): string | undefined {
  return /\{([^}]+)\}/.exec(text)?.[1];
}

export function looksLikeId(segment: string): boolean {
  return ID_SEGMENT.test(segment);
}

/** Collapsed slashes, a leading slash and no trailing one. */
export function normalizePath(p: string): string {
  let out = p.replace(/\/{2,}/g, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Canonical form: collapsed slashes, no trailing slash, `{env:X}` placeholders shortened. */
export function canonicalPath(p: string): string {
  return normalizePath(p.replace(/\{env:([^}]+)\}/g, "{$1}"));
}

/** Split a path template into segments, dropping the leading empty one. */
export function segments(p: string): string[] {
  return p.split("/").filter((s, i) => !(i === 0 && s === ""));
}

export function isPlaceholder(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}
