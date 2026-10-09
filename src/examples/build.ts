import { PLACEHOLDER_RE } from "../normalize/path.js";
import type { Call, Example } from "../report/schema.js";
import type { Shape } from "../types.js";
import { byName, credentialPlaceholder } from "./names.js";
import { Rng } from "./random.js";
import { hasAlternatives, hasOptional, synth, type SynthCtx, type Variant } from "./synth.js";

type Dyn = Call["dynamic"][number];

function shapeFor(call: Call, where: Dyn["where"], name: string): Shape | undefined {
  return call.dynamic.find((d) => d.where === where && d.name === name)?.shape;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(scalar).join(",");
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

const PATHLIKE_RE = /^(endpoint|path|route|resource|url|uri|href|link|action|operation|suffix|segment|rest)$|(Path|Endpoint|Route|Resource)$/;

/** Path segments prefer short single tokens: ids from the checker, else a name rule, else one word. */
function pathValue(call: Call, name: string, ctx: SynthCtx): string {
  const shape = shapeFor(call, "path", name);
  const typed = shape && shape.type !== "object" && shape.type !== "array" && shape.type !== "unknown" && shape.type !== "dynamic";
  const plainString = !shape || (shape.type === "string" && !shape.enum);
  if (typed && !plainString) return scalar(synth(shape, name, ctx));
  if (PATHLIKE_RE.test(name)) return ctx.rng.words(2, "/");
  const v = byName(name, "string", ctx.rng);
  return v !== undefined && !/[\s/]/.test(String(v)) ? String(v) : ctx.rng.word();
}

/**
 * Placeholder values may span several segments (`{endpoint}` → `a/b`), so slashes are kept and each segment is encoded.
 * A path-like placeholder glued to the previous segment (`/v2{endpoint}`) gets its leading slash back.
 */
function fillPath(call: Call, ctx: SynthCtx): string {
  return call.pathTemplate.replace(PLACEHOLDER_RE, (m: string, name: string, offset: number) => {
    const value = pathValue(call, name, ctx).split("/").map(encodeURIComponent).join("/");
    const glued = offset > 0 && call.pathTemplate[offset - 1] !== "/" && PATHLIKE_RE.test(name);
    return glued ? `/${value}` : value;
  });
}

function hostPart(call: Call): string {
  const scheme = call.scheme ?? "https";
  if (call.hostKind === "relative") return "";
  if (call.host) return `${scheme}://${call.host}`;
  if (call.hostKind === "env" && call.envName) return `${scheme}://{env:${call.envName}}`;
  const dyn = call.dynamic.find((d) => d.where === "host");
  return `${scheme}://${call.host ?? `{${dyn?.name ?? "host"}}`}`;
}

function queryValues(call: Call, ctx: SynthCtx): Record<string, string> {
  const out: Record<string, string> = {};
  const qs = call.queryShape;
  if (!qs || qs.type !== "object") return out;
  const keys = ctx.variant === "minimal" && qs.required.length > 0 ? qs.required : Object.keys(qs.properties);
  for (const k of keys) {
    const v = synth(qs.properties[k] ?? { type: "string" }, k, ctx);
    if (v !== null && v !== undefined) out[k] = scalar(v);
  }
  return out;
}

function withQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return url;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${qs}`;
}

const CONTENT_TYPES: Record<Call["bodyEncoding"], string | undefined> = {
  json: "application/json",
  form: "application/x-www-form-urlencoded",
  multipart: "multipart/form-data",
  raw: "application/octet-stream",
  none: undefined,
};

function authHeader(call: Call): [string, string] | undefined {
  switch (call.authScheme) {
    case "bearer":
      return ["authorization", "Bearer <token>"];
    case "basic":
      return ["authorization", "Basic <base64(user:password)>"];
    case "apikey": {
      if (call.query.some((q) => credentialPlaceholder(q))) return undefined;
      const named = call.headers.find((h) => h !== "authorization" && /key|token/.test(h));
      return named ? [named, "<api-key>"] : ["authorization", "token <token>"];
    }
    default:
      return call.provider === "aws" ? ["authorization", "AWS4-HMAC-SHA256 <signature>"] : undefined;
  }
}

function headerValues(call: Call, hasBody: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of call.headers) {
    const v = call.headerValues[name];
    out[name] = v ?? `<${name}>`;
  }
  const auth = authHeader(call);
  if (auth && (!out[auth[0]] || out[auth[0]] === `<${auth[0]}>`)) out[auth[0]] = auth[1];
  const ct = CONTENT_TYPES[call.bodyEncoding];
  if (hasBody && ct && !out["content-type"]) out["content-type"] = ct;
  return out;
}

function exampleMethod(call: Call, hasBody: boolean): string {
  if (call.method !== "DYNAMIC") return call.method;
  return hasBody ? "POST" : "GET";
}

function buildOne(call: Call, variant: Variant): Example {
  const ctx: SynthCtx = { rng: new Rng(`${call.id}:${variant}`), variant };
  const query = queryValues(call, ctx);
  const bodyShape = call.body;
  const opaque = bodyShape && (bodyShape.type === "dynamic" || bodyShape.type === "unknown") && call.bodyEncoding === "json";
  const synthesized = opaque ? {} : bodyShape ? synth(bodyShape, "body", ctx) : undefined;
  const body = synthesized === null ? undefined : synthesized;
  const hasBody = body !== undefined && call.bodyEncoding !== "none";
  return {
    variant,
    method: exampleMethod(call, hasBody),
    url: withQuery(`${hostPart(call)}${fillPath(call, ctx)}`, query),
    headers: headerValues(call, hasBody),
    query,
    ...(hasBody ? { body } : {}),
    bodyEncoding: hasBody ? call.bodyEncoding : "none",
  };
}

function sameRequest(a: Example, b: Example): boolean {
  const key = (e: Example): string => JSON.stringify([e.method, e.url, e.headers, e.body ?? null]);
  return key(a) === key(b);
}

/** Concrete example requests for a call: minimal first, a "full" one when optional parts exist, an "alt" for enum / union branches. */
export function buildExamples(call: Call, max = 3): Example[] {
  const { body, queryShape: query } = call;
  const variants: Variant[] = ["minimal"];
  if (hasOptional(body) || hasOptional(query)) variants.push("full");
  if (hasAlternatives(body) || hasAlternatives(query) || call.dynamic.some((d) => d.where === "path" && hasAlternatives(d.shape))) variants.push("alt");
  const out: Example[] = [];
  for (const v of variants) {
    const ex = buildOne(call, v);
    if (!out.some((o) => sameRequest(o, ex))) out.push(ex);
    if (out.length >= max) break;
  }
  return out;
}
