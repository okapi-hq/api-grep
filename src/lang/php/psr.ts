import { argOf } from "../ir/args.js";
import { calleeChain, type Chain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, Seg, Subst } from "../ir/raw.js";
import { deref } from "../ir/values.js";
import { substitutionFor } from "../ir/wrappers.js";

/** PSR-7 request classes: `new Request($method, $uri, $headers, $body)`. */
const REQUEST_CLASSES = ["GuzzleHttp.Psr7.Request", "Nyholm.Psr7.Request", "Laminas.Diactoros.Request", "Http.Discovery.Psr17Factory"];
const SENDS = new Set(["send", "sendAsync", "sendRequest"]);

interface RequestObject {
  ctor: Seg;
  subst?: Subst;
}

const isRequestClass = (c: Chain): boolean => c.root.kind === "external" && REQUEST_CLASSES.includes(c.segs.map((s) => s.name).join("."));

/** The `new Request(...)` behind an argument, also when a project helper builds it (`$http->jsonRequest('POST', $url, $data)`). */
function requestObject(arg: Scoped, ctx: IrCtx): RequestObject | undefined {
  const d = deref(arg.expr, arg.fn, ctx);
  if (d.expr.k !== "call") return undefined;
  const chain = calleeChain(d.expr, d.fn, ctx);
  if (d.expr.isNew && isRequestClass(chain)) return { ctor: chain.segs[chain.segs.length - 1]! };
  if (chain.root.kind !== "function" || chain.segs.length > 0) return undefined;
  const helper = chain.root.fn;
  const ret = helper.returns[0];
  if (helper.returns.length !== 1 || ret?.k !== "call" || !ret.isNew) return undefined;
  const inner = calleeChain(ret, helper, ctx);
  return isRequestClass(inner) ? { ctor: inner.segs[inner.segs.length - 1]!, subst: substitutionFor(helper, d.expr, d.fn) } : undefined;
}

/** `$client->send(new Request('POST', $url, $headers, $body))`, PSR-18 `sendRequest(...)`: the request object says it all. */
export function detectPsrRequest(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const last = chain.segs[chain.segs.length - 1];
  if (!last || last.call !== call || !SENDS.has(last.name) || !call.args[0]) return undefined;
  const req = requestObject({ expr: call.args[0].value, fn }, ctx);
  if (!req) return undefined;
  const method = argOf(req.ctor, 0);
  const url = argOf(req.ctor, 1);
  const headers = argOf(req.ctor, 2);
  const body = argOf(req.ctor, 3);
  const guzzle = chain.root.kind === "external" && chain.segs[0]?.name === "GuzzleHttp";
  return {
    call,
    fn,
    client: guzzle ? "guzzle" : "psr-18",
    url,
    method,
    body,
    bodyRole: "body",
    headers: headers ? [headers] : [],
    subst: req.subst,
    inputs: [url, method, body].filter((v): v is Scoped => !!v),
  };
}
