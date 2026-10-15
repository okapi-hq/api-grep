import { assembleCalls, type ResolvedCall } from "../../assemble.js";
import { isSafeKey } from "../../record-keys.js";
import type { BodyResult } from "../../resolve/body.js";
import { addHeader, type HeadersResult } from "../../resolve/header-names.js";
import { staticText } from "../../resolve/parts.js";
import { partsToUrlShape } from "../../resolve/url-shape.js";
import type { Call } from "../../report/schema.js";
import type { BodyEncoding, DynamicPart, Part } from "../../types.js";
import { dataBody, formBody, pairsShape } from "./body.js";
import { splitParts, type ShellRequest } from "./request.js";

export interface BuildCtx {
  envHints: Record<string, string>;
  /** A data file's text (`-d @payload.json`), read from the repository. */
  readFile: (path: Part[]) => string | undefined;
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** `Name: value` lines (`Name;` sends an empty header) as header names, literal values and the auth scheme. */
function headersOf(lines: Part[][]): HeadersResult {
  const out: HeadersResult = { names: [], values: {}, authScheme: "none", known: true };
  for (const line of lines) {
    const [name, value] = splitParts(line, ":", 1);
    const key = name ? staticText(name)?.trim() : undefined;
    const empty = !value && key?.endsWith(";");
    const header = empty ? key!.slice(0, -1) : key;
    if (!header || !HEADER_NAME.test(header) || (!value && !empty)) continue;
    const trimmed = value ? trimStart(value) : [{ kind: "static", text: "" } as Part];
    addHeader(out, header, trimmed);
  }
  return out;
}

function trimStart(parts: Part[]): Part[] {
  const first = parts[0];
  if (first?.kind !== "static") return parts;
  const text = first.text.trimStart();
  return [...(text ? [{ ...first, text }] : []), ...parts.slice(1)];
}

const ENCODINGS: [RegExp, BodyEncoding][] = [
  [/json/i, "json"],
  [/x-www-form-urlencoded/i, "form"],
  [/multipart\//i, "multipart"],
  [/xml/i, "xml"],
];

function bodyOf(req: ShellRequest, headers: HeadersResult, ctx: BuildCtx): BodyResult {
  const body = req.body ?? (req.form.length > 0 ? formBody(req.form) : req.data.length > 0 ? dataBody(req.data, ctx.readFile) : undefined);
  if (!body) return { encoding: "none", dynamic: [], fromLiteral: false };
  const type = headers.values["content-type"];
  const declared = typeof type === "string" ? ENCODINGS.find(([re]) => re.test(type))?.[1] : undefined;
  // the content type the command sets says how a body it could not read is sent (`-d "$PAYLOAD"` as JSON)
  if (declared && (body.encoding === "raw" || (declared === "json" && body.encoding === "form" && body.shape?.type !== "object"))) body.encoding = declared;
  return body;
}

function methodOf(req: ShellRequest, dynamic: DynamicPart[]): string {
  if (!req.method) return req.implied ?? "GET";
  const text = staticText(req.method);
  if (text !== undefined && /^[A-Za-z]+$/.test(text)) return text.toUpperCase();
  const hole = req.method.find((p) => p.kind !== "static");
  dynamic.push({ where: "method", name: hole?.name ?? "method", origin: hole ? (hole.kind === "env" ? "env" : hole.origin) : "unknown" });
  return "DYNAMIC";
}

function queryOf(items: Part[][]): { q: ResolvedCall["query"]; dynamic: DynamicPart[] } {
  const { shape, dynamic } = pairsShape(items, "query");
  const names = Object.keys(shape.properties).filter(isSafeKey);
  return { q: { names, shape: shape.properties }, dynamic };
}

/** One request of a command line, at `location`, as the report's calls. */
export function buildShellCall(req: ShellRequest, location: Call["location"], via: string | undefined, ctx: BuildCtx): Call[] {
  const dynamic: DynamicPart[] = [];
  const method = methodOf(req, dynamic);
  const url = partsToUrlShape(req.url, { envHints: ctx.envHints });
  dynamic.push(...url.dynamic);
  const headers = headersOf(req.headers);
  const body = bodyOf(req, headers, ctx);
  dynamic.push(...body.dynamic);
  const query = queryOf(req.query);
  dynamic.push(...query.dynamic);
  const definite = headers.authScheme !== "none" && headers.authScheme !== "unknown";
  const authScheme = definite || !req.auth ? headers.authScheme : req.auth;
  return assembleCalls({
    location,
    client: req.client,
    url,
    method,
    dynamic,
    body,
    headers: { names: headers.names, values: headers.values, authScheme },
    query: query.q,
    via,
    optionsOpaque: req.opaque,
  });
}
