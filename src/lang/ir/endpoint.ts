import type { EndpointSource } from "../../types.js";
import { argAt } from "./args.js";
import { calleeChain } from "./chain.js";
import type { Scoped } from "./language.js";
import { sameExpr } from "./cache.js";
import type { IrCtx, IrSdkMatch, Seg } from "./raw.js";
import { deref, staticKey } from "./values.js";

/**
 * The endpoint of a GraphQL client call (#54) in a tree-sitter language: the URL and headers given to the client
 * (`Client(url=...)`), or to the transport built for it (`Client(transport=RequestsHTTPTransport(url=..., headers=...))`).
 * Unknown when the code gives none the scan can read.
 */

export interface IrEndpoint {
  url?: Scoped;
  headers?: Scoped;
}

/** The transport construction an option holds, as a chain segment whose arguments can be read. */
function transportSeg(s: Scoped, names: string[], ctx: IrCtx): Seg | undefined {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k !== "call") return undefined;
  const chain = calleeChain(d.expr, d.fn, ctx);
  const last = chain.segs.at(-1);
  return chain.root.kind === "external" && last?.call === d.expr && names.includes(last.name) ? last : undefined;
}

/**
 * The endpoint of a GraphQL or JSON-RPC client call. Null for a JSON-RPC client built with no provider (web3.py's
 * `Web3()` looks for a local socket first) or with one that is not HTTP (`WebsocketProvider`, `IPCProvider`, #52).
 */
export function irEndpoint(m: IrSdkMatch, ctx: IrCtx): IrEndpoint | null {
  const spec = m.entry.endpoint;
  if (!spec || m.spec.subscription) return {};
  const before = m.segs.slice(0, -1);
  for (let i = before.length - 1; i >= 0; i--) {
    const seg = before[i]!;
    const client = seg.call && Object.hasOwn(spec.clients, seg.name) ? spec.clients[seg.name]! : undefined;
    if (!client) continue;
    const own = clientEndpoint(seg, client, spec, ctx);
    if (!seg.cache) return own;
    // a client read from a cache (#98): every value's endpoint, one only when they all agree
    const all = [own, ...seg.cache.others.map((o) => (Object.hasOwn(spec.clients, o.name) ? clientEndpoint(o, spec.clients[o.name]!, spec, ctx) : {}))];
    if (all.some((e) => e === null)) return null;
    if (seg.cache.keyed && all.some((e) => pickedByKey(e!, ctx))) return {};
    return all.every((e) => sameUrl(e!, own!, ctx)) ? own : {};
  }
  return {};
}

/** `RPC_URLS[chain_id]`, `RPC_URLS.get(chain_id)`: a URL picked with a key known at run time. */
function pickedByKey(e: IrEndpoint, ctx: IrCtx): boolean {
  const u = e.url ? deref(e.url.expr, e.url.fn, ctx) : undefined;
  const key = u?.expr.k === "index" ? u.expr.key : u?.expr.k === "call" && u.expr.fn.k === "attr" && u.expr.fn.name === "get" ? u.expr.args[0]?.value : undefined;
  return !!key && staticKey(key, u!.fn, ctx) === undefined;
}

type Spec = NonNullable<IrSdkMatch["entry"]["endpoint"]>;

function clientEndpoint(seg: Seg, client: Spec["clients"][string], spec: Spec, ctx: IrCtx): IrEndpoint | null {
  const own = read(seg, client, ctx);
  if (own.url) return own;
  const transport = client.transport ? argAt(seg, client.transport, ctx) : undefined;
  if (spec.nonHttp && client.transport && (!transport || transportSeg(transport, spec.nonHttp, ctx))) return null;
  const transports = spec.transports ?? {};
  const t = transport ? transportSeg(transport, Object.keys(transports), ctx) : undefined;
  return t ? read(t, transports[t.name]!, ctx) : {};
}

/** Two endpoints with the same URL: the same literal or variable, written in the same scope; an unknown one agrees with nothing. */
function sameUrl(a: IrEndpoint, b: IrEndpoint, ctx: IrCtx): boolean {
  if (!a.url || !b.url) return false;
  const [x, y] = [deref(a.url.expr, a.url.fn, ctx), deref(b.url.expr, b.url.fn, ctx)];
  return (x.fn === y.fn || x.expr.k === "str") && sameExpr(x.expr, y.expr);
}

function read(seg: Seg, source: EndpointSource, ctx: IrCtx): IrEndpoint {
  const url = source.url ? argAt(seg, source.url, ctx) : undefined;
  return url ? { url, headers: source.headers ? argAt(seg, source.headers, ctx) : undefined } : {};
}
