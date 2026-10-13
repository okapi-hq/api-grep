import type { ScopedCall } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import type { Expr } from "../../ir/model.js";
import type { IrCtx } from "../../ir/raw.js";
import { argAt, calleeIs, fluentChain, type RequestParts } from "../../ir/steps.js";

/** Where a client's defaults are: the calls creating it, the argument holding its options and their setters. */
export interface ClientOptions {
  creates: string[];
  arg: number;
  options: string[];
  host: string;
  port: string;
  ssl: string;
}

interface Defaults {
  host?: Scoped;
  port?: Scoped;
  ssl?: boolean;
}

/** `WebClient.create(vertx, new WebClientOptions().setSsl(true).setDefaultHost("api.example.com"))`: the defaults it sets. */
function defaultsOf(start: ScopedCall, spec: ClientOptions, ctx: IrCtx): Defaults {
  const client = start.call.fn.k === "attr" ? { expr: start.call.fn.obj, fn: start.fn } : undefined;
  const created = client ? fluentChain(client, (c) => calleeIs(c, spec.creates) !== undefined, ctx).start : undefined;
  const options = created ? argAt(created, spec.arg) : undefined;
  const fc = options ? fluentChain(options, (c) => calleeIs(c, spec.options) !== undefined, ctx) : undefined;
  const out: Defaults = {};
  for (const step of fc?.start ? fc.steps : []) {
    const name = step.call.fn.k === "attr" ? step.call.fn.name : "";
    const arg = argAt(step, 0);
    if (name === spec.host) out.host = arg;
    else if (name === spec.port) out.port = arg;
    else if (name === spec.ssl) out.ssl = arg?.expr.k === "bool" && arg.expr.v;
  }
  return out;
}

const portOf = (s: Scoped | undefined): number | undefined => (s?.expr.k === "num" ? s.expr.v : undefined);

/**
 * Vert.x `get(443, "api.example.com", "/v1/x")`, `get("api.example.com", "/v1/x")` and `get("/v1/x")` from argument
 * `from` on, with the default host, port and TLS of the client's options. A literal port other than 80 and 443 is
 * written in the URL; without TLS or port 443 the scheme is `http`, as the client's.
 */
export function hostPath(p: RequestParts, c: ScopedCall, from: number, spec: ClientOptions, ctx: IrCtx): void {
  const args = [0, 1, 2].flatMap((i) => argAt(c, from + i) ?? []);
  const d = defaultsOf(c, spec, ctx);
  const [port, host, path] = args.length >= 3 ? args : args.length === 2 ? [d.port, args[0], args[1]] : [d.port, d.host, args[0]];
  if (!path) return;
  if (!host) {
    p.url = path;
    return;
  }
  const number = portOf(port);
  p.scheme = { expr: { k: "str", v: d.ssl || number === 443 ? "https" : "http" }, fn: host.fn };
  const authority: Expr = number === undefined || number === 80 || number === 443 ? host.expr : { k: "tmpl", parts: [host.expr, { k: "str", v: `:${number}` }] };
  p.host = { expr: authority, fn: host.fn };
  p.path.push(path);
}
