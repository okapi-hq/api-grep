import { argAt } from "./args.js";
import { calleeChain } from "./chain.js";
import type { IrEndpoint } from "./endpoint.js";
import type { Scoped } from "./language.js";
import type { IrCtx, Seg } from "./raw.js";
import { deref } from "./values.js";

/**
 * A client built without its transport and given one later (the Kotlin MCP SDK's `client.connect(transport)`): the
 * transports the file connects this construction with. Null when every one is not HTTP (stdio), the one HTTP endpoint,
 * else unknown (none connected in the file, or several to different servers).
 */
export function connectedEndpoint(client: Seg, connect: string, endpointOf: (t: Scoped) => IrEndpoint | null, ctx: IrCtx): IrEndpoint | null {
  if (!client.call || !client.fn) return {};
  const transports: Scoped[] = [];
  for (const f of client.fn.module.allFunctions) {
    for (const c of f.calls) {
      if (c.fn.k !== "attr" || c.fn.name !== connect) continue;
      const segs = calleeChain(c, f, ctx).segs;
      const t = segs.slice(0, -1).some((s) => s.call === client.call) ? argAt(segs.at(-1), "0", ctx) : undefined;
      if (t) transports.push(t);
    }
  }
  if (transports.length === 0) return {};
  const http = transports.map(endpointOf).filter((e): e is IrEndpoint => e !== null);
  if (http.length === 0) return null;
  const url = (e: IrEndpoint) => (e.url ? deref(e.url.expr, e.url.fn, ctx).expr : undefined);
  const first = url(http[0]!);
  return first && http.every((e) => url(e) === first) ? http[0]! : {};
}
