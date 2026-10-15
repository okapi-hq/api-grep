import { isSafeKey } from "../../record-keys.js";
import type { BodyResult } from "../../resolve/body.js";
import { staticText } from "../../resolve/parts.js";
import { jsonToShape } from "../../resolve/shape-utils.js";
import type { DynamicPart, Part, Shape } from "../../types.js";
import { holesOf, valueShape } from "./body.js";
import { dropPrefix, emptyRequest, leadingText, looksLikeUrl, type ShellRequest } from "./request.js";

const VALUED = new Set(
  (
    "--auth -a --auth-type -A --session --session-read-only --output -o --verify --cert --cert-key --cert-key-pass " +
    "--proxy --timeout --max-redirects --print -p --pretty --style -s --format-options --response-charset " +
    "--response-mime --boundary --raw --default-scheme --ssl --ciphers --history-print -P --unix-socket"
  ).split(" "),
);

const METHOD = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;

/** Item separators, longest first at a position: `:=@`, `==`, `=@`, `:=`, `@`, `=`, `:`, `;`. */
const SEPARATORS = [":=@", "==", "=@", ":=", "@", "=", ":", ";"];

interface Item {
  key: string;
  sep: string;
  value: Part[];
}

/** `Header:value`, `name==query`, `field=text`, `field:=json`, `file@path`: the key must be written out. */
function itemOf(arg: Part[]): Item | undefined {
  const text = leadingText(arg);
  let best: { at: number; sep: string } | undefined;
  for (const sep of SEPARATORS) {
    const at = text.indexOf(sep);
    if (at > 0 && (!best || at < best.at)) best = { at, sep };
  }
  if (!best) return undefined;
  return { key: text.slice(0, best.at), sep: best.sep, value: dropPrefix(arg, best.at + best.sep.length) };
}

interface Flags {
  form: boolean;
  multipart: boolean;
  authType?: string;
  auth: boolean;
}

function readFlags(args: Part[][], flags: Flags): Part[][] {
  const rest: Part[][] = [];
  for (let i = 0; i < args.length; i++) {
    const text = leadingText(args[i]!);
    const [name, inline] = text.startsWith("--") ? [text.split("=")[0]!, text.includes("=") ? text.slice(text.indexOf("=") + 1) : undefined] : [text, undefined];
    if (!text.startsWith("-") || text === "-") rest.push(args[i]!);
    else if (name === "--form" || name === "-f") flags.form = true;
    else if (name === "--multipart") flags.multipart = true;
    else if (VALUED.has(name)) {
      const value = inline ?? (args[i + 1] ? (staticText(args[++i]!) ?? "") : "");
      if (name === "--auth" || name === "-a") flags.auth = true;
      if (name === "--auth-type" || name === "-A") flags.authType = value.toLowerCase();
    }
  }
  return rest;
}

/** A JSON value written after `:=` (`n:=1`, `tags:='["a"]'`). */
function rawJson(value: Part[]): Shape {
  const text = staticText(value);
  if (text === undefined) return { type: "unknown" };
  try {
    return jsonToShape(JSON.parse(text));
  } catch {
    return { type: "unknown" };
  }
}

function bodyOf(fields: Item[], flags: Flags): BodyResult | undefined {
  if (fields.length === 0) return undefined;
  const properties: Record<string, Shape> = {};
  const dynamic: DynamicPart[] = [];
  for (const f of fields) {
    if (!isSafeKey(f.key)) continue;
    properties[f.key] = f.sep === ":=" ? rawJson(f.value) : f.sep === "=" ? valueShape(f.value) : f.sep === ":=@" ? { type: "unknown" } : { type: "string" };
    if (f.sep === "=" || f.sep === ":=") dynamic.push(...holesOf(f.value, "body", f.key));
  }
  const files = fields.some((f) => f.sep === "@");
  const encoding = flags.multipart || (files && flags.form) || files ? "multipart" : flags.form ? "form" : "json";
  return { shape: { type: "object", properties, required: Object.keys(properties) }, encoding, dynamic, fromLiteral: true };
}

/** `:3000/api` and `:/api` are localhost; a URL without a scheme takes the command's (`http` or `https`). */
function urlOf(url: Part[], scheme: string): Part[] {
  const text = leadingText(url);
  if (text.startsWith(":")) return [{ kind: "static", text: `${scheme}://localhost` }, ...(text.startsWith(":/") ? dropPrefix(url, 1) : url)];
  if (url[0]?.kind !== "static" || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return url;
  return [{ kind: "static", text: `${scheme}://` }, ...url];
}

/** An HTTPie command line (`http POST api.example.com/items name=x n:=1 Authorization:"Bearer $T"`). */
export function parseHttpie(args: Part[][], opaque: boolean, scheme: "http" | "https"): ShellRequest[] {
  const flags: Flags = { form: false, multipart: false, auth: false };
  const positional = readFlags(args, flags);
  const first = positional[0] ? staticText(positional[0]) : undefined;
  const method = first !== undefined && METHOD.test(first) && positional.length > 1 ? positional.shift() : undefined;
  const url = positional.shift();
  if (!url || !(looksLikeUrl(url) || leadingText(url).startsWith(":"))) return [];
  const req: ShellRequest = { ...emptyRequest("httpie"), opaque, url: urlOf(url, scheme), method };
  const fields: Item[] = [];
  for (const arg of positional) {
    const item = itemOf(arg);
    if (!item) continue;
    if (item.sep === ":") req.headers.push(arg);
    else if (item.sep === ";") req.headers.push([{ kind: "static", text: `${item.key};` }]);
    else if (item.sep === "==") req.query.push([{ kind: "static", text: `${item.key}=` }, ...item.value]);
    else fields.push(item);
  }
  req.body = bodyOf(fields, flags);
  req.implied = req.body ? "POST" : "GET";
  if (flags.auth) req.auth = !flags.authType || flags.authType === "basic" ? "basic" : flags.authType === "bearer" ? "bearer" : "unknown";
  return [req];
}
