import path from "node:path";
import { assembleCall } from "./assemble.js";
import { languageOf } from "./language.js";
import type { Call } from "./report/schema.js";
import { resolveBody } from "./resolve/body.js";
import { evaluate } from "./resolve/evaluate.js";
import { resolveHeaders } from "./resolve/headers.js";
import { resolveMethod } from "./resolve/method.js";
import { resolveQuery } from "./resolve/query.js";
import { sdkUrl } from "./resolve/sdk-url.js";
import { partsToUrlShape, resolveUrl } from "./resolve/url.js";
import type { BodyEncoding, DynamicPart, EvalCtx, Part, RawCall, UrlShape } from "./types.js";

export interface BuildCtx extends EvalCtx {
  rootDir: string;
  sdkVersion: (file: string, pkg: string) => string | undefined;
}

function nodeHttpUrl(raw: RawCall, ctx: EvalCtx): UrlShape {
  const o = raw.nodeOpts!;
  const parts: Part[] = [{ kind: "static", text: `${o.scheme}://` }];
  const hostParts: Part[] = o.hostExpr ? evaluate(o.hostExpr, ctx) : [{ kind: "dynamic", name: "host", origin: "unknown" }];
  parts.push(...hostParts);
  if (o.portExpr) parts.push({ kind: "static", text: ":" }, ...evaluate(o.portExpr, ctx));
  const pathParts: Part[] = o.pathExpr ? evaluate(o.pathExpr, ctx) : [{ kind: "static", text: "/" }];
  parts.push(...pathParts);
  return partsToUrlShape(parts, ctx);
}

function defaultEncoding(raw: RawCall, method: string): BodyEncoding {
  if (raw.encoding) return raw.encoding;
  if (raw.sdk?.spec.encoding) return raw.sdk.spec.encoding;
  if (raw.bodyKey === "form") return "form";
  if (!raw.bodyExpr && (method === "GET" || method === "HEAD")) return "none";
  return "json";
}

function location(raw: RawCall, rootDir: string): Call["location"] {
  const sf = raw.node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(raw.node.getStart());
  return { file: path.relative(rootDir, sf.getFilePath()).split(path.sep).join("/"), line, col: column, language: languageOf(sf.getFilePath()) };
}

function resolveTarget(raw: RawCall, ctx: EvalCtx, dynamic: DynamicPart[]): { url: UrlShape; method: string } {
  if (raw.sdk) return sdkUrl(raw, ctx);
  const url = raw.nodeOpts ? nodeHttpUrl(raw, ctx) : resolveUrl(raw.urlExpr, ctx, raw.baseUrlExpr);
  const m = resolveMethod(raw.impliedMethod, raw.methodExpr, ctx);
  if (m.dynamic) dynamic.push(m.dynamic);
  return { url, method: m.method };
}

function resolveAuth(raw: RawCall, ctx: EvalCtx): { names: string[]; values: Record<string, string | null>; authScheme: Call["authScheme"] } {
  if (raw.sdk) return { names: [], values: {}, authScheme: raw.sdk.auth ?? "unknown" };
  const call = resolveHeaders(raw.headersExpr, ctx);
  const inst = resolveHeaders(raw.instanceHeadersExpr, ctx);
  const definite = (s: Call["authScheme"]): boolean => s !== "none" && s !== "unknown";
  const fromHeaders = definite(call.authScheme) ? call.authScheme : inst.authScheme !== "none" ? inst.authScheme : call.authScheme;
  const authScheme = definite(fromHeaders) || !raw.authHint ? fromHeaders : raw.authHint;
  return { names: [...new Set([...call.names, ...inst.names])], values: { ...inst.values, ...call.values }, authScheme };
}

/** Resolves a RawCall into the report's Call record. */
export function buildCall(raw: RawCall, base: BuildCtx): Call {
  const ctx: EvalCtx = { subst: raw.subst ?? base.subst, envHints: base.envHints };
  const dynamic: DynamicPart[] = [];
  const { url, method } = resolveTarget(raw, ctx, dynamic);
  dynamic.push(...url.dynamic);
  const body = resolveBody(raw.bodyExpr, ctx, defaultEncoding(raw, method));
  dynamic.push(...body.dynamic);
  if (raw.optionsOpaque && !raw.impliedMethod && !raw.methodExpr) dynamic.push({ where: "method", name: "options", origin: "unknown" });
  const q = resolveQuery(raw.queryExpr, ctx);
  dynamic.push(...q.dynamic);
  const sdk = raw.sdk;
  return assembleCall({
    location: location(raw, base.rootDir),
    client: raw.client,
    sdk: sdk
      ? { package: sdk.package, version: base.sdkVersion(raw.node.getSourceFile().getFilePath(), sdk.package), chain: sdk.chain, provider: sdk.provider, operationId: sdk.spec.operationId }
      : undefined,
    framework: raw.framework,
    url,
    method,
    dynamic,
    body,
    headers: resolveAuth(raw, ctx),
    query: { names: q.names, shape: q.shape },
    via: raw.via,
    codeBaseUrl: !!raw.baseUrlExpr,
    optionsOpaque: raw.optionsOpaque,
  });
}
