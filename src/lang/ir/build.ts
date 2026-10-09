import { assembleCall } from "../../assemble.js";
import { relativePosix } from "../../files.js";
import type { Call, Language } from "../../report/schema.js";
import { staticText } from "../../resolve/parts.js";
import { sdkTarget, type SdkSource } from "../../resolve/sdk-template.js";
import { joinParts, partsToUrlShape } from "../../resolve/url-shape.js";
import type { AuthScheme, BodyEncoding, DynamicPart, Part, UrlShape } from "../../types.js";
import { argAt, argOf, propOf } from "./args.js";
import { evaluate } from "./evaluate.js";
import type { Scoped } from "./language.js";
import { withSubst, type IrCtx, type IrRaw, type IrSdkMatch } from "./raw.js";
import { resolveIrBody, resolveIrHeaders, resolveIrQuery } from "./request.js";

export interface BuildIrCtx extends IrCtx {
  rootDir: string;
  language: Language;
  sdkVersion: (file: string, pkg: string) => string | undefined;
}

function urlParts(s: Scoped, ctx: IrCtx): Part[] {
  return evaluate(s.expr, s.fn, ctx);
}

/** A client base URL given as a bare host (`withBaseUri('api.example.com/v1')`) is an https URL. */
function baseUrlParts(s: Scoped, ctx: IrCtx): Part[] {
  const parts = urlParts(s, ctx);
  const first = parts[0];
  const bareHost = first?.kind === "static" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/|$)/i.test(first.text);
  return bareHost ? [{ kind: "static", text: "https://" }, ...parts] : parts;
}

function resolveUrl(url: Scoped | undefined, base: Scoped | undefined, ctx: IrCtx): UrlShape {
  if (!url && !base) return { hostKind: "unknown", pathTemplate: "/", query: [], queryShape: {}, dynamic: [{ where: "host", name: "url", origin: "unknown" }], raw: "" };
  const pathParts = url ? urlParts(url, ctx) : [];
  const baseParts = base ? urlParts(base, ctx) : [];
  return partsToUrlShape(joinParts(baseParts, pathParts), { envHints: ctx.envHints });
}

function resolveMethod(raw: IrRaw, ctx: IrCtx, dynamic: DynamicPart[]): string {
  if (raw.impliedMethod) return raw.impliedMethod.toUpperCase();
  if (!raw.method) return "GET";
  const parts = urlParts(raw.method, ctx);
  const text = staticText(parts);
  if (text !== undefined) return text.toUpperCase() || "GET";
  const d = parts.find((p): p is Exclude<Part, { kind: "static" }> => p.kind !== "static");
  dynamic.push({ where: "method", name: d ? d.name : "method", origin: !d ? "unknown" : d.kind === "env" ? "env" : d.origin });
  return "DYNAMIC";
}

/** `params` sources: `arg:N` (or the keyword named like the placeholder), `kw:name`, `instance:N`, `seg:name:N`, `chain:a,b`. */
function sdkParam(m: IrSdkMatch, source: string, name: string, ctx: IrCtx): { expr?: Scoped; parts?: Part[] } | undefined {
  const before = m.segs.slice(0, -1);
  const chain = /^chain:([\w,]+)$/.exec(source);
  if (chain) {
    const names = new Set(chain[1]!.split(","));
    const pieces = before.filter((s) => s.call && names.has(s.name)).map((s) => argOf(s, 0));
    if (pieces.length === 0 || pieces.some((p) => !p)) return {};
    return { parts: pieces.flatMap((p, i) => [...(i ? [{ kind: "static", text: "/" } as Part] : []), ...urlParts(p!, ctx)]) };
  }
  const seg = /^seg:(\w+):(\d+)$/.exec(source);
  if (seg) return { expr: argOf([...before].reverse().find((s) => s.name === seg[1]), Number(seg[2]), name) };
  const m2 = /^(arg|kw|instance):(\w+)(?:\.(\w+))?$/.exec(source);
  if (!m2) return undefined;
  const target = m2[1] === "instance" ? before[before.length - 1] : m.method;
  const base = m2[1] === "kw" ? argOf(target, undefined, m2[2]) : argOf(target, Number(m2[2]), name);
  return { expr: m2[3] ? propOf(base, m2[3], ctx) : base };
}

function sdkSource(raw: IrRaw, ctx: IrCtx): SdkSource<Scoped> {
  const m = raw.sdk!;
  return {
    spec: m.spec,
    host: m.spec.host ?? m.entry.host,
    inlinePath: m.entry.inlinePathLiterals,
    basePath: m.entry.basePath,
    baseUrl: raw.baseUrl,
    envHints: ctx.envHints,
    evaluate: (s) => urlParts(s, ctx),
    urlParts: (s) => baseUrlParts(s, ctx),
    param: (source, name) => sdkParam(m, source, name, ctx),
    arg: (i, name) => argOf(m.method, i, name),
    bodyProp: (name) => propOf(raw.body, name, ctx) ?? argAt(m.method, `kw:${name}`, ctx),
  };
}

function defaultEncoding(raw: IrRaw, method: string): BodyEncoding {
  if (raw.encoding) return raw.encoding;
  if (raw.sdk?.spec.encoding) return raw.sdk.spec.encoding;
  if (!raw.body && (method === "GET" || method === "HEAD")) return "none";
  return "json";
}

function authOf(raw: IrRaw, fromHeaders: AuthScheme): AuthScheme {
  if (raw.sdk) return raw.sdk.spec.auth ?? raw.sdk.entry.auth ?? "unknown";
  const definite = fromHeaders !== "none" && fromHeaders !== "unknown";
  return definite || !raw.auth ? fromHeaders : raw.auth;
}

/** Resolves a detected call into the report's Call record. */
export function buildIrCall(raw: IrRaw, base: BuildIrCtx): Call {
  const ctx = withSubst(base, raw.subst);
  const dynamic: DynamicPart[] = [];
  const target = raw.sdk ? sdkTarget(sdkSource(raw, ctx)) : undefined;
  const method = target?.method ?? resolveMethod(raw, ctx, dynamic);
  // an SDK call to a URL the client was built with (`WebhookClient(url).send(...)`) goes there
  const url = target && !raw.url ? target.url : resolveUrl(raw.url, raw.sdk ? undefined : raw.baseUrl, ctx);
  dynamic.push(...url.dynamic);
  const body = resolveIrBody(raw.body, raw.bodyRole, defaultEncoding(raw, method), ctx);
  if (raw.encoding && body.shape) body.encoding = raw.encoding;
  dynamic.push(...body.dynamic);
  if (raw.optionsOpaque && !raw.impliedMethod && !raw.method) dynamic.push({ where: "method", name: "options", origin: "unknown" });
  const q = resolveIrQuery(raw.query, ctx);
  dynamic.push(...q.dynamic);
  const headers = raw.sdk ? { names: [], values: {}, authScheme: "none" as AuthScheme } : resolveIrHeaders(raw.headers, ctx);
  const file = raw.fn.module.file;
  const sdk = raw.sdk;
  return assembleCall({
    location: { file: relativePosix(base.rootDir, file), line: raw.call.pos.line, col: raw.call.pos.col, language: base.language },
    client: raw.client,
    sdk: sdk ? { package: sdk.entry.package, version: base.sdkVersion(file, sdk.entry.package), chain: sdk.key, provider: sdk.entry.provider, operationId: sdk.spec.operationId } : undefined,
    url,
    method,
    dynamic,
    body,
    headers: { names: headers.names, values: headers.values, authScheme: authOf(raw, headers.authScheme) },
    query: { names: q.names, shape: q.shape },
    via: raw.via,
    codeBaseUrl: !!raw.baseUrl,
    optionsOpaque: raw.optionsOpaque,
  });
}
