import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import type { Callee, MethodSpec, RawCall, RegistryEntry } from "../types.js";
import { declarationsOf, getProp } from "../ast/object.js";
import { exportedChain, isNamedImport } from "./callee.js";
import { clientEndpoint, type Endpoint } from "./endpoint.js";
import { mcpEndpoint } from "./mcp-endpoint.js";
import { mcpServerEndpoints } from "./mcp-servers.js";
import { contractCall } from "./rpc-contract.js";
import { rpcEndpoint } from "./rpc-endpoint.js";
import { keepsSender, withSenderArgs } from "./sender.js";
import type { Registry } from "./registry/index.js";

function candidateKeys(callee: Callee, reg: RegistryEntry): string[] {
  const keys = new Set<string>();
  const own = callee.chain.join(".");
  if (own) keys.add(own);
  if (callee.instance) {
    const ctorNames = new Set(reg.instance?.names ?? ["default"]);
    const instChain = callee.instance.chain.filter((n) => !ctorNames.has(n));
    // a method of a record built with `new` (`new shopify.rest.Product({ session }).save()`, #92)
    if (callee.instance.kind === "new" && instChain.length > 0 && callee.chain.length === 1) keys.add(`${instChain.join(".")}#${callee.chain[0]}`);
    // a record read with `find` (`await shopify.rest.Product.find({ session, id })`, #102)
    if (callee.instance.kind === "call" && instChain.length > 1 && callee.chain.length === 1 && reg.recordFrom?.includes(instChain.at(-1)!)) {
      keys.add(`${instChain.slice(0, -1).join(".")}#${callee.chain[0]}`);
    }
    // a method of what a factory returns, when the name alone is too common (`createCartServerHandlers().get`, #102)
    if (callee.instance.kind === "call" && callee.chain.length === 1) keys.add(`${callee.instance.chain.join(".")}#${callee.chain[0]}`);
    const flat = [...instChain, ...callee.chain].join(".");
    if (flat) keys.add(flat);
  } else if (!callee.viaType) {
    const exp = exportedChain(callee).join(".");
    if (exp) keys.add(exp);
  }
  for (const k of [...keys]) if (k.startsWith("rest.")) keys.add(k.slice(5));
  for (const [from, to] of Object.entries(reg.keyAliases ?? {})) for (const k of [...keys]) if (k.startsWith(from)) keys.add(to + k.slice(from.length));
  return [...keys];
}

/**
 * The variable a record method is called on (`product` of `product.save()`), declared with the record's `new` or read
 * with one of `recordFrom` (`find`): then `found` is the options that read it (`{ session, id }`), whose ids it holds.
 */
function recordOf(node: CallExpression, reg: RegistryEntry): RawCall["record"] {
  const callee = unwrap(node.getExpression());
  const target = Node.isPropertyAccessExpression(callee) ? unwrap(callee.getExpression()) : undefined;
  const decl = target && Node.isIdentifier(target) ? declarationsOf(target)[0] : undefined;
  if (!decl || !Node.isVariableDeclaration(decl)) return undefined;
  const init = decl.getInitializer();
  const read = init ? unwrap(init) : undefined;
  const reader = read && Node.isCallExpression(read) ? unwrap(read.getExpression()) : undefined;
  const found = reader && Node.isPropertyAccessExpression(reader) && reg.recordFrom?.includes(reader.getName()) ? (read as CallExpression).getArguments()[0] : undefined;
  return { decl, ...(found ? { found: found as Expression } : {}) };
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

/** A base URL among the settings of a model client built here (`new ChatOpenAI({ configuration: { baseURL } })`). */
function ownBaseUrl(args: Expression[], spec: MethodSpec): Expression | undefined {
  for (const where of spec.baseUrlProp ?? []) {
    const value = where.split(".").reduce<Expression | undefined>((e, key) => getProp(e, key), args[spec.bodyArg ?? 0]);
    if (value) return value;
  }
  return undefined;
}

/** The URL a method that also builds the client is given (`spec.ownBaseUrl`: A2A `createFromUrl(url)`), by `instance.urlArg`. */
function constructionUrl(args: Expression[], spec: MethodSpec, callee: Callee, reg: RegistryEntry): Expression | undefined {
  const where = spec.ownBaseUrl ? reg.instance?.urlArg?.[callee.chain.at(-1) ?? ""] : undefined;
  if (where === undefined) return undefined;
  const [idx, prop] = String(where).split(".");
  return prop ? getProp(args[Number(idx)], prop) : args[Number(idx)];
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

/** Whether an argument is an object (a literal, or a value of an object type): not an id. */
function isObjectArg(e: Expression): boolean {
  const u = unwrap(e);
  if (Node.isObjectLiteralExpression(u)) return true;
  const t = u.getType();
  return t.isObject() && !t.isArray() && t.getCallSignatures().length === 0;
}

/** The arguments as the library reads them when an optional id may be left out (`optionalId`): a hole for no id. */
function withOptionalId(args: Expression[], at: number | undefined): Expression[] {
  const given = at !== undefined ? args[at] : undefined;
  if (at === undefined || !given) return args;
  const u = unwrap(given);
  if (Node.isNullLiteral(u) || (Node.isIdentifier(u) && u.getText() === "undefined")) return Object.assign([...args], { [at]: undefined });
  if (args.length !== at + 1 || !isObjectArg(given)) return args;
  const out = [...args];
  out.splice(at, 1, undefined as unknown as Expression, given);
  return out;
}

function buildRaw(node: CallExpression | NewExpression, reg: RegistryEntry, key: string, spec: MethodSpec, callee: Callee, endpoint?: Endpoint): RawCall | null {
  const own = endpointFirst(node.getArguments() as Expression[], spec, callee);
  const args = withOptionalId(own.args, spec.optionalId);
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
      ...(reg.routes ? { routes: reg.routes } : {}),
      anyHost: !!reg.endpoint,
    },
    bodyKey: "input",
  };
  if (spec.bodyArg !== undefined) raw.bodyExpr = spec.bodyProp ? getProp(args[spec.bodyArg], spec.bodyProp) : args[spec.bodyArg];
  if (spec.queryArg !== undefined) raw.queryExpr = args[spec.queryArg];
  if (spec.urlFromInstanceArg !== undefined && callee.instance) raw.urlExpr = callee.instance.args[spec.urlFromInstanceArg];
  // `options.model` reads a property of a property (Claude Agent SDK `query({ prompt, options: { model } })`)
  if (spec.modelArg !== undefined) raw.modelExpr = (spec.modelProp?.split(".") ?? []).reduce<Expression | undefined>((e, key) => getProp(e, key), args[spec.modelArg]);
  const record = spec.record && Node.isCallExpression(node) ? recordOf(node, reg) : undefined;
  if (record) raw.record = record;
  if (reg.endpoint?.agent) return withServers(raw, mcpServerEndpoints(node, key, callee, reg));
  if (reg.endpoint) return withEndpoint(raw, node, reg, spec, callee, own, endpoint);
  const base = ownBaseUrl(args, spec) ?? constructionUrl(args, spec, callee, reg) ?? clientUrlArg(callee, reg);
  if (base) raw.baseUrlExpr = base;
  return raw;
}

/**
 * A GraphQL or JSON-RPC client call: the endpoint and headers its client was built with, and the request's own
 * headers; none for a JSON-RPC client that does not read as HTTP (a browser wallet).
 */
function withEndpoint(raw: RawCall, node: CallExpression | NewExpression, reg: RegistryEntry, spec: MethodSpec, callee: Callee, own: { url?: Expression; client?: Expression }, given?: Endpoint): RawCall | null {
  const args = raw.sdk!.args;
  const endpoint = given ?? (own.url ? { url: own.url } : reg.endpoint!.connect ? mcpEndpoint(node, reg, spec, args) : reg.endpoint!.nonHttp ? rpcEndpoint(node, reg, spec, callee, args, own.client) : clientEndpoint(node, reg, spec, callee, args));
  if (!endpoint) return null;
  if (endpoint.url) raw.baseUrlExpr = endpoint.url;
  if (endpoint.headers) raw.instanceHeadersExpr = endpoint.headers;
  if (endpoint.transport) raw.mcpTransport = endpoint.transport;
  // a node vendor's client builds its URL itself (`InfuraProvider`)
  if (endpoint.host) raw.sdk = { ...raw.sdk!, host: endpoint.host, spec: { ...spec, path: `${endpoint.path ?? ""}${spec.path}` } };
  if (spec.headersArg !== undefined) raw.headersExpr = raw.sdk!.args[spec.headersArg];
  return raw;
}

/** An agent framework's MCP call: one per HTTP server of its client, none when it has none. */
function withServers(raw: RawCall, servers: Endpoint[]): RawCall | null {
  const each = servers.map((ep): RawCall => ({ ...raw, baseUrlExpr: ep.url, instanceHeadersExpr: ep.headers, mcpTransport: ep.transport }));
  return each.length > 1 ? { ...each[0]!, also: each.slice(1) } : (each[0] ?? null);
}

/**
 * A GraphQL client's method is called on the client, not on what another method returns: the Observable of
 * `client.watchQuery(...)` has a `subscribe` too, and it sends nothing more.
 */
function onClient(callee: Callee, reg: RegistryEntry): boolean {
  if (!reg.endpoint || !callee.instance) return true;
  return (reg.instance?.names ?? []).includes(callee.instance.chain.at(-1) ?? "default");
}

/**
 * A call of a registry's package. A package with several registries (`@openai/agents`: its model requests and its MCP
 * servers) gives the calls of each: the first, the others in `also`.
 */
export function detectSdk(node: CallExpression | NewExpression, callee: Callee, registry: Registry): RawCall | null {
  const raws = registry.allByPackage(callee.package).flatMap((reg) => detectWith(node, callee, reg) ?? []);
  if (raws.length < 2) return raws[0] ?? null;
  return { ...raws[0]!, also: [...(raws[0]!.also ?? []), ...raws.slice(1)] };
}

function detectWith(node: CallExpression | NewExpression, callee: Callee, reg: RegistryEntry): RawCall | null {
  if (Node.isNewExpression(node)) {
    const name = exportedChain(callee).join(".");
    // own keys only: `toString` or `constructor` on a client is not a registry method
    const spec = reg.commands && Object.hasOwn(reg.commands, name) ? reg.commands[name] : undefined;
    return spec ? buildRaw(node, reg, name, spec, callee) : null;
  }
  // a contract object's function (#78), before its name is read as one of the client's own methods
  const contract = reg.endpoint?.nonHttp && !reg.endpoint.connect && !reg.endpoint.agent ? contractCall(node, callee, reg) : undefined;
  if (contract !== undefined) return contract && buildRaw(node, reg, contract.key, contract.spec, callee, contract.endpoint);
  if (!reg.methods || !onClient(callee, reg)) return null;
  for (const key of candidateKeys(callee, reg)) {
    const spec = Object.hasOwn(reg.methods, key) ? reg.methods[key] : undefined;
    if (spec?.sendsThrough && !keepsSender(node, spec.sendsThrough)) return null;
    const raw = spec ? buildRaw(node, reg, key, spec, callee) : undefined;
    if (raw && spec?.sendsThrough) return withSenderArgs(raw, node, spec.sendsThrough);
    if (raw !== undefined) return raw;
  }
  return null;
}
