import type { Chain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, FunctionDef } from "../../ir/model.js";
import type { IrCtx, IrRaw, Seg } from "../../ir/raw.js";
import { rootLength } from "../../ir/sdk.js";
import { applyStep, calleeIs, emptyParts, lambdaCalls, lambdaOf, readSteps, type RequestParts } from "../../ir/steps.js";
import { rawOf } from "./request.js";
import { JVM } from "./tables.js";

const K = JVM.ktor;

/** `method = HttpMethod.Post`, `url.host = "..."` and `host = "..."` in a builder lambda. */
function lambdaAssigns(fn: FunctionDef, p: RequestParts): void {
  for (const a of fn.assigns) {
    const value: Scoped = { expr: a.value, fn };
    if (a.target === "method") [p.method, p.impliedMethod] = [value, undefined];
    else if (a.target === "host" || a.target === "url.host") p.host = value;
    else if (a.target === "encodedPath" || a.target === "url.encodedPath") p.path.push(value);
  }
}

/** A builder lambda (`{ parameter(...); header(...); setBody(...) }`) and the `url { ... }` / `headers { ... }` in it. */
function readLambda(lambda: FunctionDef, p: RequestParts): void {
  readSteps(lambdaCalls(lambda), K.tables.request!, p, K.tables);
  lambdaAssigns(lambda, p);
  for (const c of lambda.calls) {
    const inner = calleeIs(c, ["url"]) ? lambdaOf(c) : undefined;
    if (inner) lambdaAssigns(inner, p);
  }
}

/**
 * `HttpClient(CIO) { defaultRequest { url("https://api.example.com/"); header(...) } }`: the base URL and the headers
 * every request of the client gets.
 */
function clientDefaults(instance: Seg | undefined): RequestParts | undefined {
  const config = instance?.call ? lambdaOf(instance.call) : undefined;
  if (!config) return undefined;
  const p = emptyParts();
  for (const c of config.calls) {
    const block = calleeIs(c, K.defaults) !== undefined || (calleeIs(c, ["install"]) && c.args[0]?.value.k === "name" && c.args[0].value.name === "DefaultRequest") ? lambdaOf(c) : undefined;
    if (block) readLambda(block, p);
  }
  return p;
}

/** Ktor: `client.get(url) { parameter(...); header(...) }`, `client.post { url(...); setBody(item) }`, `client.request(url) { method = ... }`. */
export function detectKtor(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "external") return undefined;
  const verb = chain.segs[chain.segs.length - 1];
  const n = rootLength(chain.segs, K.imports);
  if (!verb || verb.call !== call || n <= 0 || !Object.hasOwn(K.verbs, verb.name)) return undefined;
  const instance = chain.segs.slice(n, -1).find((s) => (s.call || s.typed) && K.clients.includes(s.name));
  if (!instance) return undefined;
  const p = emptyParts();
  const defaults = clientDefaults(instance);
  if (defaults) {
    p.baseUrl = defaults.url;
    p.pairs.push(...defaults.pairs.map((x) => ({ ...x, from: "default" as const })));
  }
  applyStep(p, K.verbs[verb.name]!, { call, fn });
  // `get(urlString = url)`: the URL as a named argument
  const named = call.args.find((a) => a.name === "urlString" || a.name === "url");
  if (named && !p.url) p.url = { expr: named.value, fn };
  const lambda = lambdaOf(call);
  if (lambda) readLambda(lambda, p);
  return rawOf(call, fn, K.client, p, ctx);
}
