import type { Expression } from "ts-morph";
import { getProp } from "../detect/options.js";
import type { EvalCtx, Part, RawCall, UrlShape } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";
import { refParts } from "./ref-path.js";
import { partsToUrlShape, resolveUrl, urlParts } from "./url.js";

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

function originOfExpr(e: Expression | undefined, ctx: EvalCtx): string | undefined {
  if (!e) return undefined;
  const parts = evaluate(e, ctx);
  if (staticText(parts) !== undefined) return undefined;
  const d = parts.find((p) => p.kind !== "static");
  return d?.kind === "env" ? "env" : d?.kind === "dynamic" ? d.origin : "unknown";
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

/** Registry host + path template; placeholders stay as `{name}` with the origin of the argument behind them. */
function staticHostUrl(raw: RawCall, pathT: string, ctx: EvalCtx): UrlShape {
  const sdk = raw.sdk!;
  const parts: Part[] = [{ kind: "static", text: `https://${sdk.host}` }, { kind: "static", text: pathT }];
  const url = partsToUrlShape(parts, ctx);
  url.hostKind = "literal";
  url.host = sdk.host;
  const names = [...pathT.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
  url.dynamic = names.map((name, i) => ({ where: "path" as const, name, origin: sdkPathOrigin(raw, name, i, ctx) })).filter((d) => d.origin !== "static");
  return url;
}

/** Expression behind a placeholder: `params` (`arg:N`, `instance:N`, `ref:N`), then `pathArgs` by position, then the body. */
function paramSource(raw: RawCall, name: string, index: number, ctx: EvalCtx): { expr?: Expression; ref: boolean } {
  const sdk = raw.sdk!;
  const m = /^(arg|instance|ref):(\d+)$/.exec(sdk.spec.params?.[name] ?? "");
  if (m) {
    const args = m[1] === "instance" ? (sdk.instanceArgs ?? []) : sdk.args;
    return { expr: args[Number(m[2])], ref: m[1] === "ref" };
  }
  const argIdx = sdk.spec.pathArgs?.[index];
  if (argIdx !== undefined) return { expr: sdk.args[argIdx], ref: false };
  if (sdk.spec.pathFromBody?.includes(name)) return { expr: getProp(raw.bodyExpr, name, ctx), ref: false };
  return { ref: false };
}

/** Literal values are written in; a lone dynamic value keeps the placeholder's name; mixed values keep their parts. */
function paramParts(raw: RawCall, name: string, index: number, ctx: EvalCtx, sdkNames: Set<string>): Part[] {
  const { expr, ref } = paramSource(raw, name, index, ctx);
  if (!expr) {
    sdkNames.add(name);
    return [{ kind: "static", text: `{${name}}` }];
  }
  const parts = ref ? refParts(expr, ctx) : evaluate(expr, ctx);
  const only = parts.length === 1 ? parts[0]! : undefined;
  if (only?.kind === "dynamic") return [{ ...only, name }];
  if (only?.kind === "env") return [{ kind: "dynamic", name, origin: "env" }];
  return parts;
}

/**
 * Path template with its values written in (`/rest/v1/{table}` + `from("todos")` -> `/rest/v1/todos`), on the base URL
 * given to the client's constructor when there is one, else on the registry host.
 */
function templatedUrl(raw: RawCall, pathT: string, ctx: EvalCtx): UrlShape {
  const sdkNames = new Set<string>();
  const path: Part[] = [];
  let last = 0;
  let index = 0;
  for (const m of pathT.matchAll(PLACEHOLDER_RE)) {
    path.push({ kind: "static", text: pathT.slice(last, m.index) }, ...paramParts(raw, m[1]!, index++, ctx, sdkNames));
    last = m.index + m[0].length;
  }
  path.push({ kind: "static", text: pathT.slice(last) });
  const base = raw.baseUrlExpr ? partsToUrlShape([...urlParts(raw.baseUrlExpr, ctx), ...path], ctx) : undefined;
  const url = base && base.hostKind !== "unknown" && base.hostKind !== "relative" ? base : partsToUrlShape([{ kind: "static", text: `https://${raw.sdk!.host}` }, ...path], ctx);
  if (url !== base) {
    url.hostKind = "literal";
    url.host = raw.sdk!.host;
    url.dynamic = url.dynamic.filter((d) => d.where !== "host");
  }
  for (const m of pathT.matchAll(/[?&]([^=&]+)=\{([^}]+)\}/g)) if (sdkNames.has(m[2]!)) sdkNames.add(m[1]!);
  url.dynamic = url.dynamic.map((d) => (sdkNames.has(d.name) && d.origin === "unknown" ? { ...d, origin: "sdk" } : d));
  return url;
}

/** URL and method of an SDK call from its registry entry. */
export function sdkUrl(raw: RawCall, ctx: EvalCtx): { url: UrlShape; method: string } {
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
  return { url: sdk.inlinePath ? templatedUrl(raw, pathT, ctx) : staticHostUrl(raw, pathT, ctx), method };
}
