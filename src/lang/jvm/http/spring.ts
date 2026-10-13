import type { Chain } from "../../ir/chain.js";
import { fluentMap, type ScopedCall } from "../../ir/fluent.js";
import { detectHttp } from "../../ir/http.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, FunctionDef } from "../../ir/model.js";
import type { IrCtx, IrRaw, Seg } from "../../ir/raw.js";
import { rootLength } from "../../ir/sdk.js";
import { argAt, calleeIs, emptyParts, readSteps, type RequestParts } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";
import { rawOf, readUrl, urlParts } from "./request.js";
import { builderInterceptors, requestEntity, restTemplateInterceptors } from "./spring-parts.js";
import { JVM, type FluentClient } from "./tables.js";

const isHeaders = (s: Scoped, ctx: IrCtx): boolean => fluentMap(s.expr, s.fn, ctx)?.spec.objects.includes("HttpHeaders") ?? false;

/** `HttpEntity(body, headers)`, `HttpEntity(headers)`: the body and the headers the entity carries. */
function unwrapEntity(raw: IrRaw, ctx: IrCtx): void {
  if (!raw.body) return;
  const d = deref(raw.body.expr, raw.body.fn, ctx);
  if (d.expr.k !== "call" || calleeIs(d.expr, JVM.entities) === undefined) return;
  const [a, b] = [argAt({ call: d.expr, fn: d.fn }, 0), argAt({ call: d.expr, fn: d.fn }, 1)];
  const headers = b ?? (a && isHeaders(a, ctx) ? a : undefined);
  raw.body = headers === a ? undefined : a;
  if (headers) raw.headers.push(headers);
  raw.inputs.push(...[a, b].filter((x): x is Scoped => !!x));
}

/** RestTemplate (a client table: `getForObject(url, ...)`, `exchange(url, HttpMethod.POST, entity, ...)`), its `HttpEntity` read here. */
export function detectRestTemplate(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const raw = detectHttp(chain, call, fn, ctx);
  if (raw?.client !== JVM.restTemplate.client) return raw;
  raw.pairs = [...(raw.pairs ?? []), ...restTemplateInterceptors(chain.segs, ctx)];
  const entity = requestEntity(raw, ctx);
  if (entity) return entity;
  unwrapEntity(raw, ctx);
  // `UriComponentsBuilder.fromHttpUrl(base).path(...).queryParam(...).toUriString()`
  const url = readUrl(raw.url, ctx);
  return { ...raw, url: url.url, query: raw.query ?? url.query, pairs: [...raw.pairs, ...url.pairs] };
}

const toCalls = (segs: Seg[]): ScopedCall[] => segs.flatMap((s) => (s.call && s.fn ? [{ call: s.call, fn: s.fn }] : []));

/** `uri { it.path("/v1/items").queryParam("limit", 20).build() }`: the URL builder the lambda returns. */
function uriLambda(steps: ScopedCall[], p: RequestParts, ctx: IrCtx): void {
  for (const s of steps) {
    const last = s.call.args[s.call.args.length - 1]?.value;
    const ret = calleeIs(s.call, ["uri"]) && last?.k === "fnref" ? last.fn.returns[0] : undefined;
    if (!ret || !last || last.k !== "fnref") continue;
    const built = urlParts({ expr: ret, fn: last.fn }, ctx) ?? readUriSteps({ expr: ret, fn: last.fn });
    if (!built) continue;
    p.path.push(...built.path);
    p.pairs.push(...built.pairs);
  }
}

/** A `UriBuilder` chain that starts from the lambda's parameter (`it.path(...)`): its steps, without a start call. */
function readUriSteps(s: Scoped): RequestParts | undefined {
  const steps: ScopedCall[] = [];
  let cur = s.expr;
  while (cur.k === "call" && cur.fn.k === "attr") {
    steps.unshift({ call: cur, fn: s.fn });
    cur = cur.fn.obj;
  }
  return steps.length > 0 ? readSteps(steps, JVM.urls.steps) : undefined;
}

function fluentRequest(spec: FluentClient, call: CallExpr, fn: FunctionDef, ctx: IrCtx, segs: Seg[]): IrRaw | undefined {
  const client = segs.findIndex((s) => spec.clients.includes(s.name));
  const verb = segs.findIndex((s, i) => i > client && !!s.call && Object.hasOwn(JVM.springRequest, s.name) && (JVM.springRequest[s.name]!.method !== undefined || JVM.springRequest[s.name]!.methodArg !== undefined));
  if (client < 0 || verb < 0) return undefined;
  const built = toCalls(segs.slice(client, verb));
  const defaults = readSteps(built, spec.clientSteps, emptyParts(), { headers: JVM.springHeaders });
  const p = emptyParts();
  p.baseUrl = defaults.baseUrl;
  p.pairs.push(...defaults.pairs.map((x) => ({ ...x, from: "default" as const })));
  // `filter(...)` (WebClient), `requestInterceptor(...)` (RestClient)
  p.pairs.push(...builderInterceptors(built, JVM.interceptors.fluent, ["filter", "intercept"], ctx));
  const steps = toCalls(segs.slice(verb));
  readSteps(steps, JVM.springRequest, p, { headers: JVM.springHeaders });
  uriLambda(steps, p, ctx);
  return rawOf(call, fn, spec.client, p, ctx);
}

/** WebClient and RestClient: `client.post().uri("/v1/items").bodyValue(item).retrieve()`, the base URL from the client's builder. */
export function detectSpringFluent(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const last = chain.segs[chain.segs.length - 1];
  if (chain.root.kind !== "external" || !last || last.call !== call) return undefined;
  for (const spec of JVM.spring) {
    const n = spec.terminals.includes(last.name) ? rootLength(chain.segs, spec.imports) : -1;
    const raw = n > 0 ? fluentRequest(spec, call, fn, ctx, chain.segs.slice(n, -1)) : undefined;
    if (raw) return raw;
  }
  return undefined;
}
