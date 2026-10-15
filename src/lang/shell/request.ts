import { staticText } from "../../resolve/parts.js";
import type { BodyResult } from "../../resolve/body.js";
import type { AuthScheme, Part } from "../../types.js";

export type ShellClient = "curl" | "wget" | "httpie";

/** A `-d` / `--data-urlencode` / `--json` / `--data-binary` value; `file` when it names a file (`@payload.json`). */
export interface DataItem {
  kind: "raw" | "urlencode" | "json" | "binary";
  parts: Part[];
  file?: Part[];
}

/** A `-F name=value` field; `file` when the value is a file's content (`-F doc=@report.pdf`). */
export interface FormItem {
  name: string;
  value: Part[];
  file: boolean;
}

/** What one command line sends, before it is resolved into a call. */
export interface ShellRequest {
  client: ShellClient;
  url: Part[];
  /** The method the command names (`-X POST`, `--method=PUT`, `http PATCH ...`). */
  method?: Part[];
  /** The method its options imply: HEAD for `-I`, PUT for `-T`, POST for data. */
  implied?: string;
  /** `Name: value` header lines. */
  headers: Part[][];
  auth?: AuthScheme;
  data: DataItem[];
  form: FormItem[];
  /** `name=value` query items (`-G` data, `--url-query`, HTTPie `name==value`). */
  query: Part[][];
  /** A body the client builds itself (HTTPie items). */
  body?: BodyResult;
  /** Options the scan could not read (`"${opts[@]}"`, `-K config`): method, headers or body may be missing. */
  opaque: boolean;
}

export function emptyRequest(client: ShellClient): ShellRequest {
  return { client, url: [], headers: [], data: [], form: [], query: [], opaque: false };
}

/** Parts split on a separator of their static text (`a=1&b=$X` on `&`), at most `max` times. */
export function splitParts(parts: Part[], sep: string, max = Infinity): Part[][] {
  const out: Part[][] = [[]];
  for (const p of parts) {
    if (p.kind !== "static") {
      out[out.length - 1]!.push(p);
      continue;
    }
    let text = p.text;
    let at = text.indexOf(sep);
    while (out.length - 1 < max && at >= 0) {
      if (at > 0) out[out.length - 1]!.push({ ...p, text: text.slice(0, at) });
      out.push([]);
      text = text.slice(at + sep.length);
      at = text.indexOf(sep);
    }
    if (text) out[out.length - 1]!.push({ ...p, text });
  }
  return out;
}

/** The parts without their first `n` static characters (`-XPOST` -> `POST`). */
export function dropPrefix(parts: Part[], n: number): Part[] {
  const first = parts[0];
  if (first?.kind !== "static") return parts;
  const rest = first.text.slice(n);
  return [...(rest ? [{ ...first, text: rest }] : []), ...parts.slice(1)];
}

/** The leading static text of some parts (`-H` of `-H"$X"`), empty when they start with a value. */
export function leadingText(parts: Part[]): string {
  const first = parts[0];
  return first?.kind === "static" ? first.text : "";
}

const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|localhost(?:[:/?#]|$)|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$))/i;

/** An argument that can be the URL: a scheme or a host first, or a value (`"$API_URL/v1"`). */
export function looksLikeUrl(parts: Part[]): boolean {
  const first = parts[0];
  if (!first) return false;
  if (first.kind !== "static") return true;
  return URLISH.test(first.text);
}

/** The URLs of a command: the arguments that read as one, an unquoted unknown value (`$OPTS`) only when no other does. */
export function urlsOf(candidates: Part[][], weak: (arg: Part[]) => boolean): Part[][] {
  const strong = candidates.filter((c) => !weak(c));
  return strong.length > 0 ? strong : candidates;
}

/** A URL without a scheme (`api.example.com/v1`) is http, as curl and wget read it. */
export function withScheme(parts: Part[], scheme = "http"): Part[] {
  const text = leadingText(parts);
  if (!text || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return parts;
  return [{ kind: "static", text: `${scheme}://` }, ...parts];
}

export const isStatic = (parts: Part[]): boolean => staticText(parts) !== undefined;
