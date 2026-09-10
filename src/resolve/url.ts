import { Node, type Expression } from "ts-morph";
import { unwrap } from "../detect/callee.js";
import type { DynamicPart, EvalCtx, HostKind, Part, UrlShape } from "../types.js";
import { collectAppendedKeys } from "./appended.js";
import { evalNewUrl, evaluate, partsToTemplate } from "./evaluate.js";

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const PLACEHOLDER_RE = /\{([^}]+)\}/g;

export function normalizePath(p: string): string {
  let out = p.replace(/\/{2,}/g, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function originMap(parts: Part[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of parts) {
    if (p.kind === "dynamic") m.set(p.name, p.origin);
    if (p.kind === "env") m.set(`env:${p.name}`, "env");
  }
  return m;
}

function placeholderName(raw: string): string {
  return raw.startsWith("env:") ? raw.slice(4) : raw;
}

function collectDynamic(text: string, where: DynamicPart["where"], origins: Map<string, string>, out: DynamicPart[]): void {
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const raw = m[1]!;
    out.push({ where, name: placeholderName(raw), origin: origins.get(raw) ?? "unknown" });
  }
}

function splitQuery(pathAndQuery: string, origins: Map<string, string>, dynamic: DynamicPart[]): { path: string; query: string[] } {
  const noFrag = pathAndQuery.split("#")[0]!;
  const [path, qs] = noFrag.split("?", 2);
  const query: string[] = [];
  for (const pair of (qs ?? "").split("&").filter(Boolean)) {
    const [key, value] = pair.split("=", 2);
    if (!key) continue;
    if (key.includes("{")) collectDynamic(key, "query", origins, dynamic);
    else {
      query.push(key);
      if (value?.includes("{")) dynamic.push({ where: "query", name: key, origin: firstOrigin(value, origins) });
    }
  }
  return { path: path ?? "", query };
}

function firstOrigin(text: string, origins: Map<string, string>): string {
  const m = PLACEHOLDER_RE.exec(text);
  PLACEHOLDER_RE.lastIndex = 0;
  return m ? (origins.get(m[1]!) ?? "unknown") : "unknown";
}

interface HostResult {
  hostKind: HostKind;
  host?: string;
  envName?: string;
  rest: string;
}

function classifyHost(template: string, parts: Part[], ctx: EvalCtx, dynamic: DynamicPart[], origins: Map<string, string>): HostResult {
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
    dynamic.push({ where: "host", name: raw, origin: origins.get(raw) ?? "unknown" });
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

export function partsToUrlShape(parts: Part[], ctx: EvalCtx = {}): UrlShape {
  const template = partsToTemplate(parts);
  const origins = originMap(parts);
  const dynamic: DynamicPart[] = [];
  const h = classifyHost(template, parts, ctx, dynamic, origins);
  const { path, query } = splitQuery(h.rest, origins, dynamic);
  const pathTemplate = normalizePath(path.replace(/\{env:([^}]+)\}/g, "{$1}"));
  collectDynamic(path, "path", origins, dynamic);
  return { hostKind: h.hostKind, host: h.host, envName: h.envName, pathTemplate, query, dynamic, raw: template };
}

export function urlParts(expr: Expression, ctx: EvalCtx): Part[] {
  const u = unwrap(expr);
  if (Node.isNewExpression(u) && u.getExpression().getText() === "URL") return evalNewUrl(u, ctx, 0);
  const parts = evaluate(u, ctx);
  const keys = Node.isIdentifier(u) ? collectAppendedKeys(u, ["set", "append"]) : [];
  if (keys.length === 0) return parts;
  const hasQuery = partsToTemplate(parts).includes("?");
  return [...parts, { kind: "static", text: keys.map((k, i) => `${i === 0 && !hasQuery ? "?" : "&"}${k}=` ).join("") }];
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
  if (!expr && !base) return { hostKind: "unknown", pathTemplate: "/", query: [], dynamic: [{ where: "host", name: "url", origin: "unknown" }], raw: "" };
  return partsToUrlShape(joinParts(baseParts, pathParts), ctx);
}
