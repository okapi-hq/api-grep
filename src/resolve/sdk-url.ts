import type { Expression } from "ts-morph";
import { memberChain } from "../detect/callee.js";
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

type Source = "arg" | "instance" | "ref" | "fn";

/** Expression behind a placeholder: `params` (`arg:N`, `instance:N.prop`, `ref:N`, `fn:N`), then `pathArgs` by position, then the body. */
function paramSource(raw: RawCall, name: string, index: number, ctx: EvalCtx): { expr?: Expression; kind: Source } {
  const sdk = raw.sdk!;
  const m = /^(arg|instance|ref|fn):(\d+)(?:\.(\w+))?$/.exec(sdk.spec.params?.[name] ?? "");
  if (m) {
    const args = m[1] === "instance" ? (sdk.instanceArgs ?? []) : sdk.args;
    const arg = args[Number(m[2])];
    return { expr: m[3] ? getProp(arg, m[3], ctx) : arg, kind: m[1] as Source };
  }
  const argIdx = sdk.spec.pathArgs?.[index];
  if (argIdx !== undefined) return { expr: sdk.args[argIdx], kind: "arg" };
  if (sdk.spec.pathFromBody?.includes(name)) return { expr: getProp(raw.bodyExpr, name, ctx), kind: "arg" };
  return { kind: "arg" };
}

/** `api.tasks.get` / `internal.billing.invoices.sync` -> `tasks/get` / `billing/invoices/sync` (Convex's `/api/run/` form). */
function convexFunctionPath(expr: Expression): Part[] {
  const { chain } = memberChain(expr);
  if (chain.length < 2) return [{ kind: "dynamic", name: "function", origin: "unknown" }];
  return [{ kind: "static", text: chain.join("/") }];
}

interface PathNames {
  /** Placeholders the code gives no value for (`{projectId}`): origin `sdk`. */
  sdk: Set<string>;
  /** Placeholders with a literal value that stay placeholders (registries without `inlinePathLiterals`). */
  literal: Set<string>;
}

/** Literal values are written in (or kept as `{name}`); a lone dynamic value keeps the placeholder's name; mixed values keep their parts. */
function paramParts(raw: RawCall, name: string, index: number, ctx: EvalCtx, names: PathNames): Part[] {
  const { expr, kind } = paramSource(raw, name, index, ctx);
  if (!expr) {
    names.sdk.add(name);
    return [{ kind: "static", text: `{${name}}` }];
  }
  const parts = kind === "ref" ? refParts(expr, ctx) : kind === "fn" ? convexFunctionPath(expr) : evaluate(expr, ctx);
  if (!raw.sdk!.inlinePath && staticText(parts) !== undefined) {
    names.literal.add(name);
    return [{ kind: "static", text: `{${name}}` }];
  }
  const only = parts.length === 1 ? parts[0]! : undefined;
  if (only?.kind === "dynamic") return [{ ...only, name }];
  if (only?.kind === "env") return [{ kind: "dynamic", name, origin: "env" }];
  return parts;
}

function pathParts(raw: RawCall, pathT: string, ctx: EvalCtx, names: PathNames): Part[] {
  const path: Part[] = [];
  let last = 0;
  let index = 0;
  for (const m of pathT.matchAll(PLACEHOLDER_RE)) {
    path.push({ kind: "static", text: pathT.slice(last, m.index) }, ...paramParts(raw, m[1]!, index++, ctx, names));
    last = m.index + m[0].length;
  }
  path.push({ kind: "static", text: pathT.slice(last) });
  return path;
}

/** On the base URL the code gives the client (minus the registry's `basePath`, which that URL replaces). */
function onCodeBase(raw: RawCall, pathT: string, ctx: EvalCtx, names: PathNames): UrlShape | undefined {
  if (!raw.baseUrlExpr) return undefined;
  const basePath = raw.sdk!.basePath;
  const rel = basePath && pathT.startsWith(basePath) ? pathT.slice(basePath.length) : pathT;
  const url = partsToUrlShape([...urlParts(raw.baseUrlExpr, ctx), ...pathParts(raw, rel, ctx, names)], ctx);
  return url.hostKind !== "unknown" && url.hostKind !== "relative" ? url : undefined;
}

/**
 * Path template with its values (`/rest/v1/{table}` + `from("todos")` -> `/rest/v1/todos` when the registry inlines
 * literals), on the base URL given to the client's constructor when there is one, else on the registry host.
 */
function templatedUrl(raw: RawCall, pathT: string, ctx: EvalCtx): UrlShape {
  const names: PathNames = { sdk: new Set(), literal: new Set() };
  let url = onCodeBase(raw, pathT, ctx, names);
  if (!url) {
    url = partsToUrlShape([{ kind: "static", text: `https://${raw.sdk!.host}` }, ...pathParts(raw, pathT, ctx, names)], ctx);
    // `{provider}` / `{mcpServer}`: the registry does not know the host either
    url.hostKind = /^\{[^}]+\}$/.test(raw.sdk!.host) ? "unknown" : "literal";
    url.host = raw.sdk!.host;
    url.dynamic = url.dynamic.filter((d) => d.where !== "host");
  }
  for (const m of pathT.matchAll(/[?&]([^=&]+)=\{([^}]+)\}/g)) if (names.sdk.has(m[2]!)) names.sdk.add(m[1]!);
  url.dynamic = url.dynamic
    .filter((d) => !(names.literal.has(d.name) && d.origin === "unknown"))
    .map((d) => (names.sdk.has(d.name) && d.origin === "unknown" ? { ...d, origin: "sdk" } : d));
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
  return { url: sdk.inlinePath || raw.baseUrlExpr ? templatedUrl(raw, pathT, ctx) : staticHostUrl(raw, pathT, ctx), method };
}
