import { Node, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import { getProp } from "../detect/options.js";
import type { DynamicPart, EvalCtx, HostKind, Part, Shape, UrlShape } from "../types.js";
import { collectAppended } from "./appended.js";
import { evalNewUrl, evaluate, partsToTemplate } from "./evaluate.js";

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
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
    const host = (end < 0 ? afterScheme : afterScheme.slice(0, end)).toLowerCase();
    const rest = end < 0 ? "" : afterScheme.slice(end);
    const env = /\{env:([^}]+)\}/.exec(host);
    if (env) return { hostKind: "env", host: hostFromHint(ctx, env[1]!) ?? host, envName: env[1], rest };
    if (host.includes("{")) {
      const prefix = host.slice(0, host.indexOf("{"));
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
      return { hostKind: "env", host: hinted, envName: name, rest: rest.startsWith("/") || rest === "" ? rest : `/${rest}` };
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

function schemeOf(template: string, ctx: EvalCtx, envName?: string): string | undefined {
  const m = SCHEME_RE.exec(template);
  if (m) return m[1]!.toLowerCase();
  const hint = envName ? ctx.envHints?.[envName] : undefined;
  const h = hint ? SCHEME_RE.exec(hint) : null;
  return h ? h[1]!.toLowerCase() : undefined;
}

export function partsToUrlShape(parts: Part[], ctx: EvalCtx = {}): UrlShape {
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

/** `searchParams.set("k", v)` calls become `?k={v}` parts so values keep their shape. */
function appendedQueryParts(u: Expression, ctx: EvalCtx, hasQuery: boolean): Part[] {
  const entries = Node.isIdentifier(u) ? collectAppended(u, ["set", "append"]) : [];
  const out: Part[] = [];
  entries.forEach((e, i) => {
    out.push({ kind: "static", text: `${i === 0 && !hasQuery ? "?" : "&"}${e.key}=` });
    if (e.value) out.push(...evaluate(e.value, ctx));
  });
  return out;
}

/** `this.config.url({ path: "/chat/completions" })` style builders: the base stays dynamic, the path is kept. */
function urlBuilderParts(u: Expression, ctx: EvalCtx): Part[] | undefined {
  if (!Node.isCallExpression(u)) return undefined;
  const arg = u.getArguments()[0];
  if (!arg || u.getArguments().length !== 1 || !Node.isObjectLiteralExpression(arg)) return undefined;
  const pathExpr = getProp(arg, "path", ctx) ?? getProp(arg, "pathname", ctx);
  if (!pathExpr) return undefined;
  const pathParts = evaluate(pathExpr, ctx);
  if (SCHEME_RE.test(partsToTemplate(pathParts))) return pathParts;
  const callee = u.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : "baseUrl";
  return [{ kind: "dynamic", name: name === "url" ? "baseUrl" : name, origin: "call" }, ...pathParts];
}

export function urlParts(expr: Expression, ctx: EvalCtx): Part[] {
  const u = unwrap(expr);
  if (Node.isNewExpression(u) && u.getExpression().getText() === "URL") return evalNewUrl(u, ctx, 0);
  const built = urlBuilderParts(u, ctx);
  if (built) return built;
  const parts = evaluate(u, ctx);
  return [...parts, ...appendedQueryParts(u, ctx, partsToTemplate(parts).includes("?"))];
}

function joinParts(base: Part[], path: Part[]): Part[] {
  const baseText = partsToTemplate(base);
  const pathText = partsToTemplate(path);
  if (SCHEME_RE.test(pathText)) return path;
  if (base.length === 0) return path;
  const needsSlash = !baseText.endsWith("/") && !pathText.startsWith("/") && pathText !== "" && !pathText.startsWith("?");
  return [...base, ...(needsSlash ? [{ kind: "static", text: "/" } as Part] : []), ...path];
}

/** Resolves a URL expression (optionally prefixed by a baseURL / prefixUrl expression) to a UrlShape. */
export function resolveUrl(expr: Expression | undefined, ctx: EvalCtx = {}, base?: Expression): UrlShape {
  const baseParts = base ? urlParts(base, ctx) : [];
  const pathParts = expr ? urlParts(expr, ctx) : [];
  if (!expr && !base) {
    return { hostKind: "unknown", pathTemplate: "/", query: [], queryShape: {}, dynamic: [{ where: "host", name: "url", origin: "unknown" }], raw: "" };
  }
  return partsToUrlShape(joinParts(baseParts, pathParts), ctx);
}
