import type { UnfollowedCall } from "../../report/schema.js";
import { calleeChain, type Chain } from "./chain.js";
import { detectHttp } from "./http.js";
import type { CallExpr, Expr, FunctionDef } from "./model.js";
import { exprText } from "./model.js";
import type { IrCtx, IrRaw } from "./raw.js";
import { receiverCalls, receiverExpr } from "./receiver.js";
import { detectSdk } from "./sdk.js";

export interface Candidate {
  call: CallExpr;
  fn: FunctionDef;
  /** The project function the call runs: a wrapper when its body makes an HTTP call with its parameters. */
  target: FunctionDef;
  /** Overloads the call may run, when its arguments do not tell which: each is expanded, and what they agree on kept. */
  targets?: FunctionDef[];
  /** The call runs an overload other than the first declared of its name. */
  overloaded?: boolean;
}

export interface IrUnfollowed {
  call: CallExpr;
  fn: FunctionDef;
  reason: UnfollowedCall["reason"];
  expr?: string;
  via?: string;
}

export interface IrDetected {
  calls: IrRaw[];
  candidates: Candidate[];
  unfollowed: IrUnfollowed[];
}

/** Detects one call: language detectors, then SDK registries, then HTTP client tables. */
export function detectCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): { raw?: IrRaw; chain: Chain } {
  const chain = calleeChain(call, fn, ctx);
  for (const d of ctx.idx.lang.detectors ?? []) {
    const raw = d(call, fn, ctx, chain);
    if (raw) return { raw, chain };
  }
  return { raw: detectSdk(chain, call, fn, ctx) ?? detectHttp(chain, call, fn, ctx), chain };
}

const URL_NAME = /url|uri|href|endpoint|path|link|route/i;
const URL_TEXT = /^(?:https?:)?\/\/|^\//;
const SENDING = new Set(["post", "put", "patch", "delete", "request", "send"]);
const READING = new Set(["get", "head", "options", "stream"]);
const FETCH_NAME = /fetch|request|http/i;

/** A literal or template URL (strong), or a value named like one (weak). */
function urlLike(e: Expr | undefined): "strong" | "weak" | undefined {
  if (!e) return undefined;
  if (e.k === "str") return URL_TEXT.test(e.v) ? "strong" : undefined;
  if (e.k === "tmpl" || e.k === "concat") {
    const first = e.parts[0];
    return first?.k === "str" ? (URL_TEXT.test(first.v) ? "strong" : undefined) : urlLike(first);
  }
  if (e.k === "format") return urlLike(e.template);
  if (e.k === "name" || e.k === "attr") return URL_NAME.test(e.name) ? "weak" : undefined;
  return undefined;
}

/**
 * `self.session.get(url)` on a client received from outside, or `self.fetch_fn(url)`: the target is not known
 * statically. Reading verbs need a literal URL, so `cache.get(url)` is not reported.
 */
function unfollowedCall(call: CallExpr, fn: FunctionDef, chain: Chain): IrUnfollowed | undefined {
  if (chain.root.kind !== "param" && chain.root.kind !== "field") return undefined;
  const first = call.args.find((a) => !a.name)?.value;
  const like = urlLike(first);
  if (!like) return undefined;
  const expr = exprText(call.fn).replace(/\$/g, "").slice(0, 80);
  if (chain.segs.length === 0) {
    const name = chain.root.name;
    return FETCH_NAME.test(name) ? { call, fn, reason: "injected-fetch", expr } : undefined;
  }
  if (chain.segs.length !== 1) return undefined;
  const verb = chain.segs[0]!.name;
  // `deps.fetch_upstream(url)`: a fetch function handed over in an object
  if (!SENDING.has(verb) && !READING.has(verb)) return FETCH_NAME.test(verb) ? { call, fn, reason: "injected-fetch", expr } : undefined;
  const ok = SENDING.has(verb) || like === "strong";
  return ok ? { call, fn, reason: "injected-client", expr } : undefined;
}

/** Every call of a function body: requests found, calls to project functions (wrapper candidates), calls not followed. */
export function detectIn(fn: FunctionDef, ctx: IrCtx): IrDetected {
  const out: IrDetected = { calls: [], candidates: [], unfollowed: [] };
  for (const call of fn.calls) {
    const { raw, chain } = detectCall(call, fn, ctx);
    if (raw) {
      out.calls.push(raw);
      continue;
    }
    if (chain.root.kind === "function" && chain.segs.length === 0) {
      out.candidates.push({ call, fn, target: chain.root.fn, ...(chain.overloaded ? { overloaded: true } : {}) });
      continue;
    }
    if (chain.overloads) {
      out.candidates.push({ call, fn, target: chain.overloads[0]!, targets: chain.overloads });
      continue;
    }
    const receiver = receiverCalls(call, fn, chain, ctx, detectCall);
    if (receiver) {
      out.calls.push(...receiver.raws);
      if (receiver.unknown) out.unfollowed.push({ call, fn, reason: "receiver-unknown", expr: receiverExpr(call) });
      continue;
    }
    const u = unfollowedCall(call, fn, chain);
    if (u) out.unfollowed.push(u);
  }
  return out;
}
