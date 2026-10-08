import type { MethodSpec, Part, UrlShape } from "../types.js";
import { staticText } from "./parts.js";
import { partsToUrlShape } from "./url-shape.js";

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

/**
 * What an SDK call's URL is built from, independently of the language: the registry method, and how to read the call's
 * arguments (`E` is the language's expression type).
 */
export interface SdkSource<E> {
  spec: MethodSpec;
  host: string;
  inlinePath?: boolean;
  basePath?: string;
  /** Base URL the code gives the client (`new OpenAI({ baseURL })`, `OpenAI(base_url=...)`). */
  baseUrl?: E;
  /** .env.example values: the host of an env base URL. */
  envHints?: Record<string, string>;
  evaluate(e: E): Part[];
  urlParts(e: E): Part[];
  /** Value of a `params` source (`arg:0`, `instance:0`, `ref:1`...): an expression, or parts already built. */
  param(source: string, name: string): { expr?: E; parts?: Part[] } | undefined;
  /** Positional argument N (`pathArgs`); `name` is the placeholder, for languages with keyword arguments. */
  arg(index: number, name?: string): E | undefined;
  /** A property of the body argument (`pathFromBody`). */
  bodyProp(name: string): E | undefined;
}

function originOfExpr<E>(src: SdkSource<E>, e: E | undefined): string | undefined {
  if (!e) return undefined;
  const parts = src.evaluate(e);
  if (staticText(parts) !== undefined) return undefined;
  const d = parts.find((p) => p.kind !== "static");
  return d?.kind === "env" ? "env" : d?.kind === "dynamic" ? d.origin : "unknown";
}

function sdkPathOrigin<E>(src: SdkSource<E>, name: string, index: number): string {
  const argIdx = src.spec.pathArgs?.[index];
  if (argIdx !== undefined) {
    const arg = src.arg(argIdx, name);
    return originOfExpr(src, arg) ?? (arg ? "static" : "unknown");
  }
  if (src.spec.pathFromBody?.includes(name)) {
    const e = src.bodyProp(name);
    return e ? (originOfExpr(src, e) ?? "static") : "unknown";
  }
  return "sdk";
}

/** Registry host + path template; placeholders stay as `{name}` with the origin of the argument behind them. */
export function staticHostUrl<E>(src: SdkSource<E>, pathT: string): UrlShape {
  const parts: Part[] = [{ kind: "static", text: `https://${src.host}` }, { kind: "static", text: pathT }];
  const url = partsToUrlShape(parts, { envHints: src.envHints });
  url.hostKind = "literal";
  url.host = src.host;
  const names = [...pathT.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
  url.dynamic = names.map((name, i) => ({ where: "path" as const, name, origin: sdkPathOrigin(src, name, i) })).filter((d) => d.origin !== "static");
  return url;
}

/** Value behind a placeholder: `params`, then `pathArgs` by position, then the body. */
function paramValue<E>(src: SdkSource<E>, name: string, index: number): { expr?: E; parts?: Part[] } {
  const source = src.spec.params?.[name];
  if (source) return src.param(source, name) ?? {};
  const argIdx = src.spec.pathArgs?.[index];
  if (argIdx !== undefined) return { expr: src.arg(argIdx, name) };
  if (src.spec.pathFromBody?.includes(name)) return { expr: src.bodyProp(name) };
  return {};
}

interface PathNames {
  /** Placeholders the code gives no value for (`{projectId}`): origin `sdk`. */
  sdk: Set<string>;
  /** Placeholders with a literal value that stay placeholders (registries without `inlinePathLiterals`). */
  literal: Set<string>;
}

/** Literal values are written in (or kept as `{name}`); a lone dynamic value keeps the placeholder's name; mixed values keep their parts. */
function paramParts<E>(src: SdkSource<E>, name: string, index: number, names: PathNames): Part[] {
  const value = paramValue(src, name, index);
  const parts = value.parts ?? (value.expr !== undefined ? src.evaluate(value.expr) : undefined);
  if (!parts) {
    names.sdk.add(name);
    return [{ kind: "static", text: `{${name}}` }];
  }
  if (!src.inlinePath && staticText(parts) !== undefined) {
    names.literal.add(name);
    return [{ kind: "static", text: `{${name}}` }];
  }
  const only = parts.length === 1 ? parts[0]! : undefined;
  if (only?.kind === "dynamic") return [{ ...only, name }];
  if (only?.kind === "env") return [{ kind: "dynamic", name, origin: "env" }];
  return parts;
}

function pathParts<E>(src: SdkSource<E>, pathT: string, names: PathNames): Part[] {
  const path: Part[] = [];
  let last = 0;
  let index = 0;
  for (const m of pathT.matchAll(PLACEHOLDER_RE)) {
    path.push({ kind: "static", text: pathT.slice(last, m.index) }, ...paramParts(src, m[1]!, index++, names));
    last = m.index + m[0].length;
  }
  path.push({ kind: "static", text: pathT.slice(last) });
  return path;
}

/** On the base URL the code gives the client (minus the registry's `basePath`, which that URL replaces). */
function onCodeBase<E>(src: SdkSource<E>, pathT: string, names: PathNames): UrlShape | undefined {
  if (src.baseUrl === undefined) return undefined;
  const rel = src.basePath && pathT.startsWith(src.basePath) ? pathT.slice(src.basePath.length) : pathT;
  const url = partsToUrlShape([...src.urlParts(src.baseUrl), ...pathParts(src, rel, names)], { envHints: src.envHints });
  return url.hostKind !== "unknown" && url.hostKind !== "relative" ? url : undefined;
}

/**
 * Path template with its values (`/rest/v1/{table}` + `from("todos")` -> `/rest/v1/todos` when the registry inlines
 * literals), on the base URL given to the client's constructor when there is one, else on the registry host.
 */
export function templatedUrl<E>(src: SdkSource<E>, pathT: string): UrlShape {
  const names: PathNames = { sdk: new Set(), literal: new Set() };
  let url = onCodeBase(src, pathT, names);
  if (!url) {
    url = partsToUrlShape([{ kind: "static", text: `https://${src.host}` }, ...pathParts(src, pathT, names)], { envHints: src.envHints });
    // `{provider}` / `{mcpServer}`: the registry does not know the host either
    url.hostKind = /^\{[^}]+\}$/.test(src.host) ? "unknown" : "literal";
    url.host = src.host;
    url.dynamic = url.dynamic.filter((d) => d.where !== "host");
  }
  for (const m of pathT.matchAll(/[?&]([^=&]+)=\{([^}]+)\}/g)) if (names.sdk.has(m[2]!)) names.sdk.add(m[1]!);
  url.dynamic = url.dynamic
    .filter((d) => !(names.literal.has(d.name) && d.origin === "unknown"))
    .map((d) => (names.sdk.has(d.name) && d.origin === "unknown" ? { ...d, origin: "sdk" } : d));
  return url;
}

/** URL and method of an SDK call from its registry entry. */
export function sdkTarget<E>(src: SdkSource<E>): { url: UrlShape; method: string } {
  let method = src.spec.method;
  let pathT = src.spec.path;
  if (src.spec.routeArg !== undefined) {
    const arg = src.arg(src.spec.routeArg);
    const route = (arg !== undefined ? staticText(src.evaluate(arg)) : undefined) ?? "";
    const m = /^([A-Z]+)\s+(\S+)$/.exec(route.trim());
    if (m) {
      method = m[1]!;
      pathT = m[2]!;
    } else method = "DYNAMIC";
  }
  return { url: src.inlinePath || src.baseUrl !== undefined ? templatedUrl(src, pathT) : staticHostUrl(src, pathT), method };
}
