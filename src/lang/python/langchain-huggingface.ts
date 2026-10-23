import { argOf } from "../ir/args.js";
import { valueChain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import { dottedPath, type CallExpr, type Expr, type FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, Seg } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { staticKey } from "../ir/values.js";

const PACKAGE = "langchain-huggingface";
const ROOTS = ["langchain_huggingface"];

/** The langchain_huggingface class an expression is built by (`HuggingFaceEndpoint(...)`, `HuggingFacePipeline.from_model_id(...)`). */
function built(e: Expr, fn: FunctionDef, ctx: IrCtx): { name: string; seg: Seg } | undefined {
  const c = valueChain(e, fn, ctx);
  const n = c.root.kind === "external" ? rootLength(c.segs, ROOTS) : -1;
  const rel = n >= 0 ? c.segs.slice(n) : [];
  const last = rel.at(-1);
  return last?.call && rel[0] ? { name: rel[0].name, seg: last } : undefined;
}

/** The model a `ChatHuggingFace` wraps: its `llm=` (or first) argument. */
function llmArg(call: CallExpr, fn: FunctionDef): Scoped | undefined {
  const a = call.args.find((x) => x.name === "llm") ?? call.args.find((x) => !x.name && !x.spread);
  return a ? { expr: a.value, fn } : undefined;
}

const isUrl = (s: Scoped | undefined, ctx: IrCtx): boolean => !!s && /^https?:\/\//.test(staticKey(s.expr, s.fn, ctx) ?? "");

/** The URL an endpoint model posts to: its `endpoint_url=`, else a URL given as `model=` (`HuggingFaceEndpointEmbeddings` too). */
function endpointUrl(seg: Seg, ctx: IrCtx): Scoped | undefined {
  const url = argOf(seg, undefined, "endpoint_url");
  if (url) return url;
  const model = argOf(seg, undefined, "model");
  return isUrl(model, ctx) ? model : undefined;
}

/** A `ChatHuggingFace(llm=...)` of the module wraps this endpoint: the chat model sends its requests, the endpoint none. */
function wrapped(raw: IrRaw, ctx: IrCtx): boolean {
  for (const f of raw.fn.module.allFunctions) {
    for (const c of f.calls) {
      if (c === raw.call || dottedPath(c.fn)?.at(-1) !== "ChatHuggingFace" || built(c, f, ctx)?.name !== "ChatHuggingFace") continue;
      const llm = llmArg(c, f);
      if (llm && built(llm.expr, llm.fn, ctx)?.seg.call === raw.call) return true;
    }
  }
  return false;
}

/** `ChatHuggingFace(llm=...)`: over an endpoint, its chat completions (under the `endpoint_url` it gives); over a pipeline, nothing. */
function chat(raw: IrRaw, ctx: IrCtx): IrRaw | undefined {
  const llm = llmArg(raw.call, raw.fn);
  const inner = llm ? built(llm.expr, llm.fn, ctx) : undefined;
  if (!inner || inner.name !== "HuggingFaceEndpoint") return inner ? undefined : raw;
  const url = endpointUrl(inner.seg, ctx);
  // the model is the repo id the router routes by; a dedicated endpoint serves one model the code does not name
  return url ? { ...raw, baseUrl: url, model: undefined } : raw;
}

/**
 * langchain-huggingface models (`langchain-huggingface.json`): the URL an endpoint is given, the endpoint a chat model
 * wraps, and models that run locally (`HuggingFacePipeline` under `ChatHuggingFace`, `from_model_id` without
 * `backend="endpoint"`) dropped.
 */
export function refineLangchainHuggingface(raw: IrRaw, ctx: IrCtx): IrRaw | undefined {
  const m = raw.sdk;
  if (m?.entry.package !== PACKAGE) return raw;
  if (m.key === "ChatHuggingFace") return chat(raw, ctx);
  if (m.key === "ChatHuggingFace.from_model_id") {
    const backend = argOf(m.method, undefined, "backend");
    return backend && staticKey(backend.expr, backend.fn, ctx) === "endpoint" ? raw : undefined;
  }
  if (m.key === "HuggingFaceEndpoint" && wrapped(raw, ctx)) return undefined;
  const url = endpointUrl(m.method, ctx);
  return url ? { ...raw, url, model: undefined } : raw;
}
