import { SCHEME_RE } from "../normalize/path.js";
import type { Part } from "../types.js";
import { partsToTemplate, staticText } from "./parts.js";

/**
 * A relative reference resolved against a base URL by the rules of RFC 3986 (section 5.2), as Retrofit and
 * `java.net.URI.resolve` do, where `joinParts` concatenates: `items` appends to the base's directory, `/health`
 * replaces its path, `.` is the directory itself, and the base's query string is dropped for any reference with a path.
 */

const AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const static_ = (text: string): Part => ({ kind: "static", text });

/** Splits parts at the first character of `chars` in a static part: before it, and from it on. */
function splitAt(parts: Part[], chars: RegExp, from = 0): [Part[], Part[]] | undefined {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind !== "static") continue;
    const at = p.text.slice(i === 0 ? from : 0).search(chars);
    if (at < 0) continue;
    const cut = at + (i === 0 ? from : 0);
    const head = p.text.slice(0, cut);
    const tail = p.text.slice(cut);
    return [[...parts.slice(0, i), ...(head ? [static_(head)] : [])], [...(tail ? [static_(tail)] : []), ...parts.slice(i + 1)]];
  }
  return undefined;
}

/** `https://host:8080` and `/v1/?key=x`; a base starting with an env or dynamic part has it as its host. */
function splitOrigin(base: Part[]): [Part[], Part[]] {
  const first = base[0];
  if (!first) return [[], []];
  const scheme = first.kind === "static" ? AUTHORITY.exec(first.text) : undefined;
  if (first.kind === "static" && !scheme) return [[], base];
  return splitAt(base, /[/?#]/, scheme ? scheme[0].length : 0) ?? [base, []];
}

/** RFC 3986 section 5.2.4: `/a/b/../c/./d` -> `/a/c/d`. */
export function removeDotSegments(path: string): string {
  const out: string[] = [];
  const segs = path.split("/");
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s === ".." && out.length > 1) out.pop();
    if (s === "." || s === "..") {
      if (last) out.push("");
      return;
    }
    out.push(s);
  });
  return out.join("/") || "/";
}

/** The directory of a base path: everything up to its last `/`. */
function directory(path: Part[]): Part[] {
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i]!;
    const at = p.kind === "static" ? p.text.lastIndexOf("/") : -1;
    if (at >= 0) return [...path.slice(0, i), static_((p as { text: string }).text.slice(0, at + 1))];
  }
  return [static_("/")];
}

/** The base's path with dot segments removed when it is all static. */
function normalized(path: Part[]): Part[] {
  const text = staticText(path);
  return text !== undefined && /(^|\/)\.\.?(\/|$)/.test(text) ? [static_(removeDotSegments(text))] : path;
}

/**
 * `BuildConfig.API_URL` with the default `https://api.example.com/v2/`: the env var stands for the origin, its
 * default's path is written out, so a reference can replace or extend it.
 */
function expandEnvBase(base: Part[]): Part[] {
  const first = base[0];
  if (first?.kind !== "env" || !first.fallback) return base;
  const m = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(first.fallback);
  return m?.[2] ? [{ ...first, fallback: m[1] }, static_(m[2]), ...base.slice(1)] : base;
}

export function resolveReference(baseParts: Part[], ref: Part[]): Part[] {
  const base = expandEnvBase(baseParts);
  const text = partsToTemplate(ref);
  // an absolute URL, or one only known at run time (`@Url`): itself
  if (base.length === 0 || SCHEME_RE.test(text) || text.startsWith("//") || (ref[0] && ref[0].kind !== "static")) return ref;
  if (text === "") return base;
  const [origin, rest] = splitOrigin(base);
  const path = splitAt(rest, /[?#]/)?.[0] ?? rest;
  if (text.startsWith("?")) return [...origin, ...path, ...ref];
  if (text.startsWith("/")) return [...origin, ...normalized(ref)];
  return [...origin, ...normalized([...directory(path), ...ref])];
}
