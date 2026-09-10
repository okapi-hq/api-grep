import { createHash } from "node:crypto";
import path from "node:path";
import type { Expression } from "ts-morph";
import { bodySourceOf, score, type Evidence } from "./confidence.js";
import { toObjectLiteral, propertyKey, getProp } from "./detect/options.js";
import { inferProvider } from "./normalize/provider.js";
import type { Call } from "./report/schema.js";
import { resolveBody } from "./resolve/body.js";
import { evaluate, staticText } from "./resolve/evaluate.js";
import { resolveHeaders } from "./resolve/headers.js";
import { resolveMethod } from "./resolve/method.js";
import { typeToShape } from "./resolve/type-shape.js";
import { partsToUrlShape, resolveUrl } from "./resolve/url.js";
import type { BodyEncoding, DynamicPart, EvalCtx, Part, RawCall, UrlShape } from "./types.js";

export interface BuildCtx extends EvalCtx {
  rootDir: string;
  sdkVersion: (file: string, pkg: string) => string | undefined;
}

function originOfExpr(e: Expression | undefined, ctx: EvalCtx): string | undefined {
  if (!e) return undefined;
  const parts = evaluate(e, ctx);
  if (staticText(parts) !== undefined) return undefined;
  const d = parts.find((p) => p.kind !== "static");
  return d?.kind === "env" ? "env" : d?.kind === "dynamic" ? d.origin : "unknown";
}

function sdkUrl(raw: RawCall, ctx: EvalCtx): { url: UrlShape; method: string } {
  const sdk = raw.sdk!;
  let method = sdk.spec.method;
  let pathT = sdk.spec.path;
  if (sdk.spec.routeArg !== undefined) {
    const route = staticText(evaluate(sdk.args[sdk.spec.routeArg]!, ctx)) ?? "";
    const m = /^([A-Z]+)\s+(\S+)$/.exec(route.trim());
    if (m) {
      method = m[1]!;
      pathT = m[2]!;
    } else method = "DYNAMIC";
  }
  if (raw.urlExpr) return { url: resolveUrl(raw.urlExpr, ctx), method };
  const parts: Part[] = [{ kind: "static", text: `https://${sdk.host}` }, { kind: "static", text: pathT }];
  const url = partsToUrlShape(parts, ctx);
  url.hostKind = "literal";
  url.host = sdk.host;
  url.dynamic = url.dynamic.filter((d) => d.where !== "host");
  const names = [...pathT.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  url.dynamic = names.map((name, i) => ({ where: "path" as const, name, origin: sdkPathOrigin(raw, name, i, ctx) })).filter((d) => d.origin !== "static");
  return { url, method };
}

function sdkPathOrigin(raw: RawCall, name: string, index: number, ctx: EvalCtx): string {
  const spec = raw.sdk!.spec;
  const argIdx = spec.pathArgs?.[index];
  if (argIdx !== undefined) return originOfExpr(raw.sdk!.args[argIdx], ctx) ?? (raw.sdk!.args[argIdx] ? "static" : "unknown");
  if (spec.pathFromBody?.includes(name)) {
    const e = getProp(raw.bodyExpr, name, ctx);
    return e ? (originOfExpr(e, ctx) ?? "static") : "unknown";
  }
  return "sdk";
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

function queryNames(expr: Expression | undefined, ctx: EvalCtx): string[] {
  if (!expr) return [];
  const lit = toObjectLiteral(expr, ctx);
  if (lit) return lit.getProperties().map((m) => propertyKey(m)).filter((k): k is string => !!k);
  const t = typeToShape(expr.getType(), expr).shape;
  return t.type === "object" ? Object.keys(t.properties) : [];
}

function defaultEncoding(raw: RawCall, method: string): BodyEncoding {
  if (raw.sdk?.spec.encoding) return raw.sdk.spec.encoding;
  if (raw.bodyKey === "form") return "form";
  if (!raw.bodyExpr && (method === "GET" || method === "HEAD")) return "none";
  return "json";
}

function location(raw: RawCall, rootDir: string): Call["location"] {
  const sf = raw.node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(raw.node.getStart());
  return { file: path.relative(rootDir, sf.getFilePath()).split(path.sep).join("/"), line, col: column };
}

function resolveTarget(raw: RawCall, ctx: EvalCtx, dynamic: DynamicPart[]): { url: UrlShape; method: string } {
  if (raw.sdk) return sdkUrl(raw, ctx);
  const url = raw.nodeOpts ? nodeHttpUrl(raw, ctx) : resolveUrl(raw.urlExpr, ctx, raw.baseUrlExpr);
  const m = resolveMethod(raw.impliedMethod, raw.methodExpr, ctx);
  if (m.dynamic) dynamic.push(m.dynamic);
  return { url, method: m.method };
}

function resolveAuth(raw: RawCall, ctx: EvalCtx): { headers: string[]; authScheme: Call["authScheme"] } {
  if (raw.sdk) return { headers: [], authScheme: raw.sdk.auth ?? "unknown" };
  const call = resolveHeaders(raw.headersExpr, ctx);
  const inst = resolveHeaders(raw.instanceHeadersExpr, ctx);
  const definite = (s: Call["authScheme"]): boolean => s !== "none" && s !== "unknown";
  const authScheme = definite(call.authScheme) ? call.authScheme : inst.authScheme !== "none" ? inst.authScheme : call.authScheme;
  return { headers: [...new Set([...call.names, ...inst.names])], authScheme };
}

/** Resolves a RawCall into the report's Call record. */
export function buildCall(raw: RawCall, base: BuildCtx): Call {
  const ctx: EvalCtx = { subst: raw.subst ?? base.subst, envHints: base.envHints };
  const loc = location(raw, base.rootDir);
  const dynamic: DynamicPart[] = [];
  const { url, method } = resolveTarget(raw, ctx, dynamic);
  dynamic.push(...url.dynamic);
  const body = resolveBody(raw.bodyExpr, ctx, defaultEncoding(raw, method));
  dynamic.push(...body.dynamic);
  if (raw.optionsOpaque && !raw.impliedMethod && !raw.methodExpr) dynamic.push({ where: "method", name: "options", origin: "unknown" });
  const { headers, authScheme } = resolveAuth(raw, ctx);
  const provider = inferProvider({ hostKind: url.hostKind, host: url.host, envName: url.envName, sdkProvider: raw.sdk?.provider });
  const evidence: Evidence = {
    sdkHit: !!raw.sdk,
    hostKind: url.hostKind,
    envHinted: url.hostKind === "env" && !!url.host,
    pathDynamicNamed: !url.dynamic.some((d) => d.where === "path" && d.name === "expr"),
    bodySource: bodySourceOf(body.shape, body.fromType, body.fromLiteral),
    viaWrapper: !!raw.via,
    specMatched: false,
    optionsOpaque: !!raw.optionsOpaque,
  };
  const id = createHash("sha1").update(`${loc.file}:${loc.line}:${loc.col}`).digest("hex").slice(0, 12);
  return {
    id,
    location: loc,
    client: raw.client,
    sdk: raw.sdk ? { package: raw.sdk.package, version: base.sdkVersion(raw.node.getSourceFile().getFilePath(), raw.sdk.package), chain: raw.sdk.chain } : undefined,
    provider,
    host: url.host,
    hostKind: url.hostKind,
    envName: url.envName,
    method,
    pathTemplate: url.pathTemplate,
    operationId: raw.sdk?.spec.operationId,
    query: [...new Set([...url.query, ...queryNames(raw.queryExpr, ctx)])],
    headers,
    authScheme,
    body: body.shape,
    bodyFromType: body.fromType,
    bodyEncoding: body.shape ? body.encoding : "none",
    dynamic,
    via: raw.via,
    confidence: score(evidence),
    findings: [],
  };
}
