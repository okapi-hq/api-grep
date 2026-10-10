import { argOf } from "../ir/args.js";
import { calleeChain, type Chain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, Seg } from "../ir/raw.js";
import { rootLength } from "../ir/sdk.js";
import { deref } from "../ir/values.js";

function isUrllib(chain: Chain, name: string): boolean {
  if (chain.root.kind !== "external") return false;
  const n = rootLength(chain.segs, ["urllib.request"]);
  return n > 0 && chain.segs.length === n + 1 && chain.segs[n]!.name === name;
}

/** `Request(url, data, headers, method=...)` behind the argument of `urlopen`. */
function requestObject(arg: Scoped, ctx: IrCtx): Seg | undefined {
  const d = deref(arg.expr, arg.fn, ctx);
  if (d.expr.k !== "call") return undefined;
  const chain = calleeChain(d.expr, d.fn, ctx);
  return isUrllib(chain, "Request") ? chain.segs[chain.segs.length - 1] : undefined;
}

/**
 * `urllib.request.urlopen(url, data)`, `urlopen(Request(url, data=..., headers=..., method=...))` and
 * `urlretrieve(url, filename)`. Without a method, urllib sends a POST when there is data, a GET otherwise.
 */
export function detectUrllib(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const retrieve = isUrllib(chain, "urlretrieve");
  if (!retrieve && !isUrllib(chain, "urlopen")) return undefined;
  const open = chain.segs[chain.segs.length - 1]!;
  const first = argOf(open, 0, "url");
  const req = first && !retrieve ? requestObject(first, ctx) : undefined;
  const url = req ? argOf(req, 0, "url") : first;
  const body = (req ? argOf(req, 1, "data") : undefined) ?? argOf(open, retrieve ? 3 : 1, "data");
  const method = req ? argOf(req, undefined, "method") : undefined;
  const headers = req ? argOf(req, 2, "headers") : undefined;
  return {
    call,
    fn,
    client: "urllib",
    url,
    method,
    impliedMethod: method ? undefined : body ? "POST" : "GET",
    body,
    bodyRole: "body:raw",
    headers: headers ? [headers] : [],
    inputs: [url, body, method].filter((v): v is Scoped => !!v),
  };
}
