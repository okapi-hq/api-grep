import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import type { Callee, MethodSpec, RawCall, RegistryEntry } from "../types.js";
import { getProp } from "../ast/object.js";
import { exportedChain, isNamedImport } from "./callee.js";
import { clientEndpoint } from "./endpoint.js";
import { rpcEndpoint } from "./rpc-endpoint.js";
import type { Registry } from "./registry/index.js";

function candidateKeys(callee: Callee, reg: RegistryEntry): string[] {
  const keys = new Set<string>();
  const own = callee.chain.join(".");
  if (own) keys.add(own);
  if (callee.instance) {
    const ctorNames = new Set(reg.instance?.names ?? ["default"]);
    const instChain = callee.instance.chain.filter((n) => !ctorNames.has(n));
    const flat = [...instChain, ...callee.chain].join(".");
    if (flat) keys.add(flat);
  } else if (!callee.viaType) {
    const exp = exportedChain(callee).join(".");
    if (exp) keys.add(exp);
  }
  for (const k of [...keys]) if (k.startsWith("rest.")) keys.add(k.slice(5));
  return [...keys];
}

/** Base URL passed to the client's constructor (`createClient(url, key)`, `new OpenAI({ baseURL })`), also through builders. */
function clientUrlArg(callee: Callee, reg: RegistryEntry): Expression | undefined {
  const urlArg = reg.instance?.urlArg;
  if (!urlArg) return undefined;
  for (const inst of [callee.rootInstance, callee.instance]) {
    // a default import (`import OpenAI from "openai"; new OpenAI(...)`) has an empty chain
    const ctor = inst ? (inst.chain[inst.chain.length - 1] ?? "default") : undefined;
    const where = ctor !== undefined ? urlArg[ctor] : undefined;
    if (!inst || where === undefined) continue;
    const [idx, prop] = String(where).split(".");
    const arg = inst.args[Number(idx)];
    return prop ? getProp(arg, prop) : arg;
  }
  return undefined;
}

/** MCP-style clients get their server URL from a transport built next to them: the one `new Transport(url)` of the file. */
function fileUrlArg(node: Node, reg: RegistryEntry): Expression | undefined {
  const from = reg.urlFromFile;
  if (!from) return undefined;
  const built = node
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter((n) => from.new.includes(n.getExpression().getText()));
  return built.length === 1 ? (built[0]!.getArguments()[from.arg] as Expression | undefined) : undefined;
}

/** A base URL among the settings of a model client built here (`new ChatOpenAI({ configuration: { baseURL } })`). */
function ownBaseUrl(args: Expression[], spec: MethodSpec): Expression | undefined {
  for (const where of spec.baseUrlProp ?? []) {
    const value = where.split(".").reduce<Expression | undefined>((e, key) => getProp(e, key), args[spec.bodyArg ?? 0]);
    if (value) return value;
  }
  return undefined;
}

/**
 * graphql-request's own `request(url, document, variables)` takes the endpoint first, or one object with its `url`:
 * the endpoint, and the method's arguments after it.
 */
function endpointFirst(all: Expression[], spec: MethodSpec, callee: Callee): { url?: Expression; client?: Expression; args: Expression[] } {
  if (!(spec.endpointFirst || spec.clientFirst) || callee.instance || callee.viaType || !(isNamedImport(callee) || callee.importedName === "*")) return { args: all };
  // viem/actions `getBalance(client, { address })`: the client, and the method's arguments after it
  if (spec.clientFirst) return { client: all[0], args: all.slice(1) };
  const first = all[0] ? unwrap(all[0]) : undefined;
  if (first && Node.isObjectLiteralExpression(first)) return { url: getProp(first, "url"), args: all };
  return { url: all[0], args: all.slice(1) };
}

function buildRaw(node: CallExpression | NewExpression, reg: RegistryEntry, key: string, spec: MethodSpec, callee: Callee): RawCall | null {
  const own = endpointFirst(node.getArguments() as Expression[], spec, callee);
  const args = own.args;
  const raw: RawCall = {
    node,
    client: "sdk",
    sdk: {
      // the package actually imported (`@supabase/ssr`, `@sentry/nextjs`), not the registry's main one
      package: callee.package ?? reg.package,
      provider: reg.provider,
      host: spec.host ?? reg.host,
      chain: key,
      spec,
      auth: spec.auth ?? reg.auth,
      args,
      instanceArgs: callee.instance?.args,
      inlinePath: reg.inlinePathLiterals,
      basePath: reg.basePath,
      routeByModel: reg.routeByModel,
      anyHost: !!reg.endpoint,
    },
    bodyKey: "input",
  };
  if (spec.bodyArg !== undefined) raw.bodyExpr = spec.bodyProp ? getProp(args[spec.bodyArg], spec.bodyProp) : args[spec.bodyArg];
  if (spec.queryArg !== undefined) raw.queryExpr = args[spec.queryArg];
  if (spec.urlFromInstanceArg !== undefined && callee.instance) raw.urlExpr = callee.instance.args[spec.urlFromInstanceArg];
  if (spec.modelArg !== undefined) raw.modelExpr = spec.modelProp ? getProp(args[spec.modelArg], spec.modelProp) : args[spec.modelArg];
  if (reg.endpoint) return withEndpoint(raw, node, reg, spec, callee, own);
  const base = ownBaseUrl(args, spec) ?? clientUrlArg(callee, reg) ?? fileUrlArg(node, reg);
  if (base) raw.baseUrlExpr = base;
  return raw;
}

/**
 * A GraphQL or JSON-RPC client call: the endpoint and headers its client was built with, and the request's own
 * headers; none for a JSON-RPC client that does not read as HTTP (a browser wallet).
 */
function withEndpoint(raw: RawCall, node: CallExpression | NewExpression, reg: RegistryEntry, spec: MethodSpec, callee: Callee, own: { url?: Expression; client?: Expression }): RawCall | null {
  const args = raw.sdk!.args;
  const endpoint = own.url ? { url: own.url } : reg.endpoint!.nonHttp ? rpcEndpoint(node, reg, spec, callee, args, own.client) : clientEndpoint(node, reg, spec, callee, args);
  if (!endpoint) return null;
  if (endpoint.url) raw.baseUrlExpr = endpoint.url;
  if (endpoint.headers) raw.instanceHeadersExpr = endpoint.headers;
  if (spec.headersArg !== undefined) raw.headersExpr = raw.sdk!.args[spec.headersArg];
  return raw;
}

/**
 * A GraphQL client's method is called on the client, not on what another method returns: the Observable of
 * `client.watchQuery(...)` has a `subscribe` too, and it sends nothing more.
 */
function onClient(callee: Callee, reg: RegistryEntry): boolean {
  if (!reg.endpoint || !callee.instance) return true;
  return (reg.instance?.names ?? []).includes(callee.instance.chain.at(-1) ?? "default");
}

export function detectSdk(node: CallExpression | NewExpression, callee: Callee, registry: Registry): RawCall | null {
  const reg = registry.byPackage(callee.package);
  if (!reg) return null;
  if (Node.isNewExpression(node)) {
    const name = exportedChain(callee).join(".");
    // own keys only: `toString` or `constructor` on a client is not a registry method
    const spec = reg.commands && Object.hasOwn(reg.commands, name) ? reg.commands[name] : undefined;
    return spec ? buildRaw(node, reg, name, spec, callee) : null;
  }
  if (!reg.methods || !onClient(callee, reg)) return null;
  for (const key of candidateKeys(callee, reg)) {
    const spec = Object.hasOwn(reg.methods, key) ? reg.methods[key] : undefined;
    if (spec) return buildRaw(node, reg, key, spec, callee);
  }
  return null;
}
