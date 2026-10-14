import path from "node:path";
import type { EvalCtx, Part, UrlShape } from "../types.js";
import { staticText } from "./parts.js";
import { partsToUrlShape } from "./url-shape.js";
import { readWsdl, type Wsdl } from "./wsdl.js";

/**
 * Where a SOAP client library's call goes (#58), the same for every language. The scan stays static: a WSDL given by
 * URL is never fetched, the service is taken to answer on that URL without its `?wsdl` query (`.asmx?WSDL`,
 * `.svc?singleWsdl`); a WSDL file of the repository gives the address it declares. An address the code sets wins.
 */
export interface SoapClientTarget {
  /** The WSDL the client is built from, a URL or a file; undefined without one (PHP `new SoapClient(null, ...)`). */
  wsdl?: Part[];
  /** The address the code gives the client (PHP `location`, node-soap `endpoint`, zeep `create_service`). */
  location?: Part[];
  /** The source file, absolute: a relative WSDL path is looked up from its directory, then from `rootDir`. */
  file: string;
  rootDir: string;
}

export interface SoapEndpoint {
  url: UrlShape;
  /** The WSDL file read, when the client's is one of the repository. */
  wsdl?: Wsdl;
}

const URL_RE = /^https?:\/\//i;
const SCHEME_RE = /^[a-z][\w+.-]*:/i;
const DRIVE_RE = /^[a-z]:[\\/]/i;
const FILE_NAME_RE = /\.(?:wsdl|xml)$/i;
const WSDL_PARAM_RE = /^(?:wsdl|singlewsdl)(?:=.*)?$/i;

/** No address the scan can tell: an unknown host, never a guess. */
export function unknownEndpoint(name = "wsdl"): UrlShape {
  return { hostKind: "unknown", pathTemplate: "/", query: [], queryShape: {}, dynamic: [{ where: "host", name, origin: "unknown" }], raw: "" };
}

/**
 * The files a WSDL reference may name: a path (relative, absolute, `file://`), or a computed directory followed by a
 * file name (`__DIR__ . '/wsdl/x.wsdl'`, `path.join(__dirname, "x.wsdl")`). Undefined for a URL or anything else.
 */
function wsdlFiles(parts: Part[], file: string, rootDir: string): string[] | undefined {
  const dir = path.dirname(file);
  const text = staticText(parts)?.trim();
  if (text !== undefined) {
    const p = text.replace(/^file:\/\//i, "");
    if (p === "" || URL_RE.test(p) || (SCHEME_RE.test(p) && !DRIVE_RE.test(p))) return undefined;
    return path.isAbsolute(p) ? [p] : [path.resolve(dir, p), path.resolve(rootDir, p)];
  }
  const tail = staticText(parts.slice(1));
  if (parts[0]?.kind !== "dynamic" || tail === undefined || !FILE_NAME_RE.test(tail)) return undefined;
  const rel = tail.replace(/^[/\\]+/, "");
  return [path.resolve(dir, rel), path.resolve(rootDir, rel)];
}

/** `https://host/track?wsdl` -> `https://host/track`: the query asking for the WSDL is not the service's. */
export function withoutWsdlQuery(parts: Part[]): Part[] {
  const i = parts.findIndex((p) => p.kind === "static" && p.text.includes("?"));
  const at = i < 0 ? -1 : (parts[i] as { text: string }).text.indexOf("?");
  const rest = i < 0 ? undefined : staticText(parts.slice(i + 1));
  if (i < 0 || rest === undefined) return parts;
  const head = (parts[i] as { text: string }).text;
  const params = `${head.slice(at + 1)}${rest}`.replace(/#.*$/, "").split("&").filter(Boolean);
  const kept = params.filter((kv) => !WSDL_PARAM_RE.test(kv));
  if (kept.length === params.length) return parts;
  return [...parts.slice(0, i), { kind: "static", text: `${head.slice(0, at)}${kept.length > 0 ? `?${kept.join("&")}` : ""}` }];
}

export function soapEndpoint(t: SoapClientTarget, ctx: EvalCtx): SoapEndpoint {
  const local = !t.wsdl || wsdlFiles(t.wsdl, t.file, t.rootDir) !== undefined;
  const wsdl = wsdlOf(t);
  if (t.location) return { url: partsToUrlShape(t.location, ctx), wsdl };
  if (wsdl?.address) return { url: partsToUrlShape([{ kind: "static", text: wsdl.address }], ctx), wsdl };
  if (local || !t.wsdl) return { url: unknownEndpoint(), wsdl };
  return { url: partsToUrlShape(withoutWsdlQuery(t.wsdl), ctx) };
}

/**
 * The operation as the client's WSDL spells it (PHP finds `$client->track()` as `Track`), the name as called when the
 * scan read no WSDL, undefined when the WSDL it read does not declare it: the method is not an operation.
 */
export function wsdlOperation(name: string, wsdl: Wsdl | undefined): string | undefined {
  return !wsdl || wsdl.operations.size === 0 ? name : wsdl.operations.get(name.toLowerCase());
}

/** The WSDL file a client is built from, when the scan can read it: to tell an operation from a library method. */
export function wsdlOf(t: Omit<SoapClientTarget, "location">): Wsdl | undefined {
  for (const f of (t.wsdl ? wsdlFiles(t.wsdl, t.file, t.rootDir) : undefined) ?? []) {
    const w = readWsdl(f, t.rootDir);
    if (w) return w;
  }
  return undefined;
}
