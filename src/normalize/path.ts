import { normalizePath } from "../resolve/url.js";

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[a-z]{1,6}_[A-Za-z0-9]{8,}|[0-9a-f]{16,})$/i;

export function looksLikeId(segment: string): boolean {
  return ID_SEGMENT.test(segment);
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
