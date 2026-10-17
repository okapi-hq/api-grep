import type { ClientSource, EndpointSource, McpServersSource } from "../../types.js";
import { argAt } from "./args.js";
import { calleeChain } from "./chain.js";
import { clientEndpoint, givenUrl, readEndpoint, type IrEndpoint } from "./endpoint.js";
import type { Scoped } from "./language.js";
import type { Entry, FunctionDef } from "./model.js";
import type { IrCtx, IrSdkMatch, Seg } from "./raw.js";
import { deref, dictOf, entryOf, staticKey } from "./values.js";

/**
 * The MCP servers an agent framework's client connects to (`EndpointSpec.agent`) in a tree-sitter language:
 * `MultiServerMCPClient({"name": {"url": ..., "transport": "streamable_http"}})`, `ClaudeAgentOptions(mcp_servers=...)`,
 * `MCPToolset(connection_params=StreamableHTTPConnectionParams(url=...))`. Each server that reads as HTTP is a call
 * of its own; a local process (stdio), an in-process server or a configuration the scan cannot read is none.
 */

/** Servers read per client, and values visited: bounds on hostile input. */
const MAX_SERVERS = 20;
const MAX_DEPTH = 6;

type Source = EndpointSource & ClientSource;
type Dict = { entries: Entry[]; fn: FunctionDef };

interface Reader {
  m: IrSdkMatch;
  ctx: IrCtx;
  out: IrEndpoint[];
  budget: { left: number };
}

/** A dotted path of keys (`requestInit.headers`). */
function pathOf(dict: Dict, path: string | undefined, ctx: IrCtx): Scoped | undefined {
  let cur: Scoped | undefined;
  let d: Dict | undefined = dict;
  for (const key of path?.split(".") ?? []) {
    cur = d ? entryOf(d, key, ctx) : undefined;
    d = cur ? dictOf(cur.expr, cur.fn, ctx) : undefined;
  }
  return cur;
}

/** One configuration dict: skipped when it runs a local process or names a transport that is not HTTP. */
function fromConfig(dict: Dict, spec: McpServersSource, r: Reader): void {
  if (spec.local?.some((k) => entryOf(dict, k, r.ctx))) return;
  const kind = spec.transport ? entryOf(dict, spec.transport.key, r.ctx) : undefined;
  const named = kind ? staticKey(kind.expr, kind.fn, r.ctx) : undefined;
  if (named !== undefined && !spec.transport!.http.includes(named)) return;
  const url = pathOf(dict, spec.url, r.ctx);
  if (url || named !== undefined) r.out.push({ url, headers: pathOf(dict, spec.headers, r.ctx) });
}

/** A transport construction (an HTTP one gives its URL and headers), or another client of the registry (its servers). */
function fromConstruction(s: Scoped, r: Reader, depth: number): void {
  if (s.expr.k !== "call") return;
  const last = calleeChain(s.expr, s.fn, r.ctx).segs.at(-1);
  if (!last || last.call !== s.expr) return;
  const spec = r.m.entry.endpoint!;
  if (spec.transports && Object.hasOwn(spec.transports, last.name)) r.out.push(readEndpoint(last, spec.transports[last.name]!, r.ctx));
  else if (Object.hasOwn(spec.clients, last.name)) readClient(last, spec.clients[last.name]!, r, depth + 1);
}

function readOne(s: Scoped, spec: McpServersSource, client: { seg: Seg; source: Source }, r: Reader, depth: number): void {
  if (--r.budget.left < 0 || depth > MAX_DEPTH || r.out.length >= MAX_SERVERS) return;
  const dict = dictOf(s.expr, s.fn, r.ctx);
  if (dict) return fromConfig(dict, spec, r);
  const d = deref(s.expr, s.fn, r.ctx);
  if (d.expr.k === "call") return fromConstruction(d, r, depth);
  const url = givenUrl(s, r.ctx);
  if (url) r.out.push({ url, headers: client.source.headers ? argAt(client.seg, client.source.headers, r.ctx) : undefined });
}

function readServers(s: Scoped, spec: McpServersSource, client: { seg: Seg; source: Source }, r: Reader, depth: number): void {
  const d = deref(s.expr, s.fn, r.ctx);
  // `{...} if token else {}`: the servers of either branch
  if (d.expr.k === "cond" && depth <= MAX_DEPTH) {
    for (const branch of [d.expr.then, d.expr.else]) readServers({ expr: branch, fn: d.fn }, spec, client, r, depth + 1);
    return;
  }
  if (spec.named) {
    const dict = dictOf(s.expr, s.fn, r.ctx);
    for (const en of dict?.entries ?? []) {
      const value = { expr: en.value, fn: dict!.fn };
      if (en.spread) readServers(value, spec, client, r, depth + 1);
      else readOne(value, spec, client, r, depth + 1);
    }
    return;
  }
  if (d.expr.k !== "list") return readOne(s, spec, client, r, depth);
  for (const item of d.expr.items) readOne({ expr: item, fn: d.fn }, spec, client, r, depth + 1);
}

function readClient(seg: Seg, source: Source, r: Reader, depth: number): void {
  // a client of one server: the URL it is given, or its transport's (none for a local one)
  if (!source.servers) {
    const own = clientEndpoint(seg, source, r.m.entry.endpoint!, r.ctx);
    if (own) r.out.push(own);
    return;
  }
  const given = argAt(seg, source.servers.at, r.ctx);
  if (given && depth <= MAX_DEPTH) readServers(given, source.servers, { seg, source }, r, depth);
}

/**
 * One endpoint per HTTP server of the client the call is made on, the call itself when it builds the client
 * (`MultiServerMCPClient(...)`). A client the scan does not see (a parameter) is one call to a server it cannot name
 * when the registry's clients all speak HTTP, none when some may run a local process.
 */
export function mcpServers(m: IrSdkMatch, ctx: IrCtx): IrEndpoint[] {
  const clients = m.entry.endpoint!.clients;
  for (let i = m.segs.length - 1; i >= 0; i--) {
    const seg = m.segs[i]!;
    if (!seg.call || !Object.hasOwn(clients, seg.name)) continue;
    const r: Reader = { m, ctx, out: [], budget: { left: 4 * MAX_SERVERS } };
    readClient(seg, clients[seg.name]!, r, 0);
    return r.out;
  }
  return Object.values(clients).some((c) => c.servers) ? [] : [{}];
}
