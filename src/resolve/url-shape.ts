import type { DynamicPart, EvalCtx, HostKind, Part, Shape, UrlShape } from "../types.js";
import { partsToTemplate } from "./parts.js";

export const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const PLACEHOLDER_RE = /\{([^}]+)\}/g;

interface Origin {
  origin: string;
  shape?: Shape;
}

type Origins = Map<string, Origin>;

export function normalizePath(p: string): string {
  let out = p.replace(/\/{2,}/g, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function originMap(parts: Part[]): Origins {
  const m: Origins = new Map();
  for (const p of parts) {
    if (p.kind === "dynamic") m.set(p.name, { origin: p.origin, shape: p.shape });
    if (p.kind === "env") m.set(`env:${p.name}`, { origin: "env", shape: { type: "string" } });
  }
  return m;
}

function placeholderName(raw: string): string {
  return raw.startsWith("env:") ? raw.slice(4) : raw;
}

function lookup(origins: Origins, raw: string): Origin {
  return origins.get(raw) ?? { origin: "unknown" };
}

function collectDynamic(text: string, where: DynamicPart["where"], origins: Origins, out: DynamicPart[]): void {
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const raw = m[1]!;
    const o = lookup(origins, raw);
    out.push({ where, name: placeholderName(raw), origin: o.origin, ...(o.shape ? { shape: o.shape } : {}) });
  }
}

function firstPlaceholder(text: string): string | undefined {
  const m = PLACEHOLDER_RE.exec(text);
  PLACEHOLDER_RE.lastIndex = 0;
  return m?.[1];
}

/** Shape of a query value from the URL template: a literal becomes a one-value enum, a placeholder its checker shape. */
function queryValueShape(value: string | undefined, origins: Origins): Shape {
  if (value === undefined) return { type: "string" };
  const ph = firstPlaceholder(value);
  if (ph === undefined) return { type: "string", enum: [decodeURIComponentSafe(value)] };
  const whole = value === `{${ph}}`;
  const shape = lookup(origins, ph).shape;
  return whole && shape && shape.type !== "object" && shape.type !== "array" ? shape : { type: "string" };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

interface SplitResult {
  path: string;
  query: string[];
  queryShape: Record<string, Shape>;
}

function splitQuery(pathAndQuery: string, origins: Origins, dynamic: DynamicPart[]): SplitResult {
  const noFrag = pathAndQuery.split("#")[0]!;
  const [path, qs] = noFrag.split("?", 2);
  const query: string[] = [];
  const queryShape: Record<string, Shape> = {};
  for (const pair of (qs ?? "").split("&").filter(Boolean)) {
    const [key, value] = pair.split("=", 2);
    if (!key) continue;
    if (key.includes("{")) {
      collectDynamic(key, "query", origins, dynamic);
      continue;
    }
    query.push(key);
    queryShape[key] = queryValueShape(value, origins);
    const ph = value !== undefined ? firstPlaceholder(value) : undefined;
    if (ph !== undefined) {
      const o = lookup(origins, ph);
      dynamic.push({ where: "query", name: key, origin: o.origin, ...(o.shape ? { shape: o.shape } : {}) });
    }
  }
  return { path: path ?? "", query, queryShape };
}

interface HostResult {
  hostKind: HostKind;
  host?: string;
  envName?: string;
  rest: string;
}

function classifyHost(template: string, parts: Part[], ctx: EvalCtx, dynamic: DynamicPart[], origins: Origins): HostResult {
  const viaConst = parts.some((p) => p.kind === "static" && p.viaConst);
  const scheme = SCHEME_RE.exec(template);
  if (scheme) {
    const afterScheme = template.slice(scheme[0].length);
    const end = afterScheme.search(/[/?#]/);
    const rawHost = end < 0 ? afterScheme : afterScheme.slice(0, end);
    const host = rawHost.replace(/^[^{]*/, (lit) => lit.toLowerCase());
    const rest = end < 0 ? "" : afterScheme.slice(end);
    const env = /\{env:([^}]+)\}/.exec(host);
    if (env) return { hostKind: "env", host: hostFromHint(ctx, env[1]!) ?? host, envName: env[1], rest };
    if (host.includes("{")) {
      const prefix = host.slice(0, host.indexOf("{"));
      // `localhost:${port}`: the placeholder is the port, the host is all of it
      if (prefix.endsWith(":")) {
        collectDynamic(host, "host", origins, dynamic);
        return { hostKind: viaConst ? "const" : "literal", host, rest };
      }
      if ((prefix.includes(".") || prefix.startsWith("localhost")) && !prefix.endsWith(".")) {
        return { hostKind: viaConst ? "const" : "literal", host: prefix, rest: `/${host.slice(prefix.length)}${rest}` };
      }
      collectDynamic(host, "host", origins, dynamic);
      return { hostKind: "unknown", host, rest };
    }
    return { hostKind: viaConst ? "const" : "literal", host, rest };
  }
  const leading = /^\{([^}]+)\}/.exec(template);
  if (leading) {
    const raw = leading[1]!;
    const rest = template.slice(leading[0].length);
    if (raw.startsWith("env:")) {
      const name = raw.slice(4);
      const hinted = hostFromHint(ctx, name);
      // the env var holds a base URL: its known value's path (`https://api.langdock.com/openai/eu/v1`) comes first
      const base = pathFromHint(ctx, name);
      return { hostKind: "env", host: hinted, envName: name, rest: base + (rest.startsWith("/") || rest === "" ? rest : `/${rest}`) };
    }
    const o = lookup(origins, raw);
    dynamic.push({ where: "host", name: raw, origin: o.origin, ...(o.shape ? { shape: o.shape } : {}) });
    return { hostKind: "unknown", rest: rest.startsWith("/") || rest === "" ? rest : `/${rest}` };
  }
  return { hostKind: "relative", rest: template };
}

function hostFromHint(ctx: EvalCtx, name: string): string | undefined {
  const hint = ctx.envHints?.[name];
  if (!hint) return undefined;
  try {
    return new URL(hint).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function pathFromHint(ctx: EvalCtx, name: string): string {
  const hint = ctx.envHints?.[name];
  if (!hint) return "";
  try {
    const p = new URL(hint).pathname;
    return p === "/" ? "" : p.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function schemeOf(template: string, ctx: EvalCtx, envName?: string): string | undefined {
  const m = SCHEME_RE.exec(template);
  if (m) return m[1]!.toLowerCase();
  const hint = envName ? ctx.envHints?.[envName] : undefined;
  const h = hint ? SCHEME_RE.exec(hint) : null;
  return h ? h[1]!.toLowerCase() : undefined;
}

/** An env var's literal default (`?? "https://..."`) stands in for a missing .env.example value. */
function withEnvDefaults(parts: Part[], ctx: EvalCtx): EvalCtx {
  const defaults: Record<string, string> = {};
  for (const p of parts) if (p.kind === "env" && p.fallback && /^https?:\/\//i.test(p.fallback)) defaults[p.name] = p.fallback;
  return Object.keys(defaults).length > 0 ? { ...ctx, envHints: { ...defaults, ...ctx.envHints } } : ctx;
}

export function partsToUrlShape(parts: Part[], baseCtx: EvalCtx = {}): UrlShape {
  const ctx = withEnvDefaults(parts, baseCtx);
  const template = partsToTemplate(parts);
  const origins = originMap(parts);
  const dynamic: DynamicPart[] = [];
  const h = classifyHost(template, parts, ctx, dynamic, origins);
  const { path, query, queryShape } = splitQuery(h.rest, origins, dynamic);
  const pathTemplate = normalizePath(path.replace(/\{env:([^}]+)\}/g, "{$1}"));
  collectDynamic(path, "path", origins, dynamic);
  const scheme = schemeOf(template, ctx, h.envName);
  return { hostKind: h.hostKind, host: h.host, envName: h.envName, scheme, pathTemplate, query, queryShape, dynamic, raw: template };
}

/** `base` + `path` with one slash between them; an absolute `path` wins. */
export function joinParts(base: Part[], path: Part[]): Part[] {
  const baseText = partsToTemplate(base);
  const pathText = partsToTemplate(path);
  if (SCHEME_RE.test(pathText)) return path;
  if (base.length === 0) return path;
  const needsSlash = !baseText.endsWith("/") && !pathText.startsWith("/") && pathText !== "" && !pathText.startsWith("?");
  return [...base, ...(needsSlash ? [{ kind: "static", text: "/" } as Part] : []), ...path];
}
