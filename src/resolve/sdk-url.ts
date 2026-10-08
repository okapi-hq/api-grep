import type { Expression } from "ts-morph";
import { memberChain } from "../detect/callee.js";
import { getProp } from "../detect/options.js";
import type { EvalCtx, Part, RawCall, UrlShape } from "../types.js";
import { evaluate } from "./evaluate.js";
import { refParts } from "./ref-path.js";
import { sdkTarget, type SdkSource } from "./sdk-template.js";
import { resolveUrl, urlParts } from "./url.js";

/** `api.tasks.get` / `internal.billing.invoices.sync` -> `tasks/get` / `billing/invoices/sync` (Convex's `/api/run/` form). */
function convexFunctionPath(expr: Expression): Part[] {
  const { chain } = memberChain(expr);
  if (chain.length < 2) return [{ kind: "dynamic", name: "function", origin: "unknown" }];
  return [{ kind: "static", text: chain.join("/") }];
}

/** `params` sources: `arg:N`, `instance:N` (the builder's arguments), `ref:N` (Firebase reference), `fn:N` (Convex function); `.prop` reads a property. */
function paramOf(raw: RawCall, source: string, ctx: EvalCtx): { expr?: Expression; parts?: Part[] } | undefined {
  const sdk = raw.sdk!;
  const m = /^(arg|instance|ref|fn):(\d+)(?:\.(\w+))?$/.exec(source);
  if (!m) return undefined;
  const args = m[1] === "instance" ? (sdk.instanceArgs ?? []) : sdk.args;
  const arg = args[Number(m[2])];
  const expr = m[3] ? getProp(arg, m[3], ctx) : arg;
  if (!expr) return {};
  if (m[1] === "ref") return { parts: refParts(expr, ctx) };
  if (m[1] === "fn") return { parts: convexFunctionPath(expr) };
  return { expr };
}

function tsSource(raw: RawCall, ctx: EvalCtx): SdkSource<Expression> {
  const sdk = raw.sdk!;
  return {
    spec: sdk.spec,
    host: sdk.host,
    inlinePath: sdk.inlinePath,
    basePath: sdk.basePath,
    baseUrl: raw.baseUrlExpr,
    envHints: ctx.envHints,
    evaluate: (e) => evaluate(e, ctx),
    urlParts: (e) => urlParts(e, ctx),
    param: (source) => paramOf(raw, source, ctx),
    arg: (i) => sdk.args[i],
    bodyProp: (name) => getProp(raw.bodyExpr, name, ctx),
  };
}

/** URL and method of an SDK call from its registry entry. */
export function sdkUrl(raw: RawCall, ctx: EvalCtx): { url: UrlShape; method: string } {
  const target = sdkTarget(tsSource(raw, ctx));
  if (raw.urlExpr) return { url: resolveUrl(raw.urlExpr, ctx), method: target.method };
  return target;
}
