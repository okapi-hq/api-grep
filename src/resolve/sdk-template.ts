import { PLACEHOLDER_RE, placeholderNames } from "../normalize/path.js";
import type { MethodSpec, Part, UrlShape } from "../types.js";
import { staticText } from "./parts.js";
import { partsToUrlShape } from "./url-shape.js";

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
  /** The registry's route helpers (`routes`), and the helper a value calls with its arguments (`Routes.user(id)`). */
  routes?: Record<string, string>;
  routeCall?(e: E): { name: string; args: E[] } | undefined;
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
  const names = placeholderNames(pathT);
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

/**
 * A value written in the code that already carries the slash before the placeholder or the extension after it
 * (Shopify's REST client takes `"products"`, `"/products"` or `"products.json"` for `{path}.json`): not doubled.
 */
function fitted(parts: Part[], before: string, after: string): Part[] {
  const out = [...parts];
  const first = out[0];
  if (first?.kind === "static" && before.endsWith("/") && first.text.startsWith("/")) out[0] = { ...first, text: first.text.replace(/^\/+/, "") };
  const ext = /^\.[a-z]+/i.exec(after)?.[0];
  const lastPart = out[out.length - 1];
  if (ext && lastPart?.kind === "static" && lastPart.text.endsWith(ext)) out[out.length - 1] = { ...lastPart, text: lastPart.text.slice(0, -ext.length) };
  return out;
}

function pathParts<E>(src: SdkSource<E>, pathT: string, names: PathNames): Part[] {
  const path: Part[] = [];
  let last = 0;
  let index = 0;
  for (const m of pathT.matchAll(PLACEHOLDER_RE)) {
    const before = pathT.slice(last, m.index);
    last = m.index + m[0].length;
    path.push({ kind: "static", text: before }, ...fitted(paramParts(src, m[1]!, index++, names), before, pathT.slice(last)));
  }
  path.push({ kind: "static", text: pathT.slice(last) });
  return path;
}

/** `baseURL: undefined`, `base_url=None`: the client keeps its default host. */
function isNullValue(parts: Part[]): boolean {
  const only = parts.length === 1 ? parts[0]! : undefined;
  return only?.kind === "dynamic" && only.shape?.type === "null";
}

/**
 * On the base URL the code gives the client (minus the registry's `basePath`, which that URL replaces). One that cannot
 * be read keeps its host unknown: the client talks to whatever it holds, not to the registry host.
 */
function onCodeBase<E>(src: SdkSource<E>, pathT: string, names: PathNames): UrlShape | undefined {
  if (src.baseUrl === undefined) return undefined;
  const base = src.urlParts(src.baseUrl);
  if (isNullValue(base)) return undefined;
  const rel = src.basePath && pathT.startsWith(src.basePath) ? pathT.slice(src.basePath.length) : pathT;
  return partsToUrlShape([...base, ...pathParts(src, rel, names)], { envHints: src.envHints });
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

/** Whether the call gives a value for the placeholder `name` through its `params` source. */
function given<E>(src: SdkSource<E>, name: string): boolean {
  const source = src.spec.params?.[name];
  const value = source ? src.param(source, name) : undefined;
  return value?.expr !== undefined || value?.parts !== undefined;
}

/**
 * Of paths a library picks by the ids it is given (Shopify's REST resources, #92): the one most placeholders of which
 * the call gives, all of those it maps through `params` given; the first when none is.
 */
function pickPath<E>(src: SdkSource<E>, candidates: string[]): string {
  let best: { path: string; score: number } | undefined;
  for (const path of candidates) {
    const mapped = placeholderNames(path).filter((n) => src.spec.params?.[n] !== undefined);
    if (mapped.every((n) => given(src, n)) && (!best || mapped.length > best.score)) best = { path, score: mapped.length };
  }
  return best?.path ?? candidates[0]!;
}

/** The method and path of a call: a record's request once its id is set (`withId`), the path the ids pick. */
function chosenRoute<E>(src: SdkSource<E>): { method: string; pathT: string } {
  const withId = src.spec.record?.withId;
  if (withId && given(src, withId.key ?? "id")) return { method: withId.method, pathT: pickPath(src, [withId.path, ...(withId.paths ?? [])]) };
  const byArg = src.spec.argPath;
  const pathT = byArg && src.arg(byArg.arg) !== undefined ? byArg.path : src.spec.path;
  return { method: src.spec.method, pathT: src.spec.paths ? pickPath(src, [pathT, ...src.spec.paths]) : pathT };
}

/**
 * `rest.put(Routes.applicationCommands(appId), ...)`: the helper's path in place of `{route}`, its arguments filling the
 * placeholders in order (the call's own arguments no longer do).
 */
function helperRoute<E>(src: SdkSource<E>): SdkSource<E> | undefined {
  const at = src.spec.routeHelperArg;
  const arg = at !== undefined ? src.arg(at) : undefined;
  const call = arg !== undefined && src.routes ? src.routeCall?.(arg) : undefined;
  const route = call && Object.hasOwn(src.routes!, call.name) ? src.routes![call.name]! : undefined;
  if (!call || route === undefined) return undefined;
  const path = src.spec.path.replace("{route}", route);
  const pathArgs = placeholderNames(path).map((_, i) => i);
  const spec = { ...src.spec, path, pathArgs, params: undefined, routeHelperArg: undefined, paths: undefined, argPath: undefined };
  return { ...src, spec, arg: (i) => call.args[i] };
}

/** URL and method of an SDK call from its registry entry. */
export function sdkTarget<E>(src: SdkSource<E>): { url: UrlShape; method: string } {
  const routed = helperRoute(src);
  if (routed) return sdkTarget(routed);
  let { method, pathT } = chosenRoute(src);
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
