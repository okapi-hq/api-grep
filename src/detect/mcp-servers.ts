import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp, propertyValue, toArrayLiteral, toObjectLiteral } from "../ast/object.js";
import { transportKind, transportOf } from "../operation/mcp-transport.js";
import type { Callee, ClientSource, EndpointSource, McpServersSource, RegistryEntry } from "../types.js";
import { at, calledName, fromTransport, listedName, MAX_DEPTH, valueOf, type Construction, type Endpoint } from "./endpoint.js";

/**
 * The MCP servers an agent framework's client connects to (`EndpointSpec.agent`): `new MultiServerMCPClient({
 * mcpServers: { name: { url, transport, headers } } })`, `experimental_createMCPClient({ transport: { type, url } })`,
 * `query({ options: { mcpServers } })`. Each server that reads as HTTP is a call of its own; a local process (stdio),
 * an in-process server or a configuration the scan cannot read is none, never a guess.
 */

/** Servers read per client: a bound on hostile input. */
const MAX_SERVERS = 20;

type Source = EndpointSource & ClientSource;

interface Reader {
  reg: RegistryEntry;
  out: Endpoint[];
  budget: { left: number };
}

/** `0.mcpServers|0`: the first place that holds a value. */
function firstAt(args: Expression[], where: string): Expression | undefined {
  for (const place of where.split("|")) {
    const v = at(args, place);
    if (v) return v;
  }
  return undefined;
}

/** A dotted path of properties (`requestInit.headers`). */
const pathOf = (obj: Expression, path: string | undefined): Expression | undefined =>
  path === undefined ? undefined : path.split(".").reduce<Expression | undefined>((e, key) => getProp(e, key), obj);

/** A string's text when it starts with a literal: `https://...` or a command; undefined for one built from values. */
function leadingText(u: Expression): string | undefined {
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralValue();
  if (Node.isTemplateExpression(u)) return u.getHead().getLiteralText() || undefined;
  return undefined;
}

/** A value read from the environment or built in a template: a URL the configuration gives. */
const isStringValue = (u: Expression): boolean => Node.isTemplateExpression(u) || /^(process|import\.meta)\.env\b/.test(u.getText());

/** One configuration object: skipped when it runs a local process or names a transport that is not HTTP. */
function fromConfig(obj: Expression, spec: McpServersSource, r: Reader): void {
  if (spec.local?.some((k) => getProp(obj, k))) return;
  const kind = spec.transport ? getProp(obj, spec.transport.key) : undefined;
  const named = kind ? leadingText(unwrap(kind)) : undefined;
  if (named !== undefined && !spec.transport!.http.includes(named)) return;
  const url = pathOf(obj, spec.url);
  const transport = transportOf(transportKind(named));
  if (url || named !== undefined) r.out.push({ url, headers: pathOf(obj, spec.headers), ...(transport ? { transport } : {}) });
}

function readOne(e: Expression, spec: McpServersSource, source: Source, args: Expression[], r: Reader, depth: number): void {
  if (--r.budget.left < 0 || depth > MAX_DEPTH || r.out.length >= MAX_SERVERS) return;
  const u = unwrap(e);
  if (Node.isIdentifier(u)) {
    const value = valueOf(u);
    if (value) readOne(value, spec, source, args, r, depth + 1);
    return;
  }
  if (Node.isObjectLiteralExpression(u)) return fromConfig(u, spec, r);
  if (Node.isNewExpression(u) || Node.isCallExpression(u)) return fromConstruction(u, r, depth);
  const text = leadingText(u);
  if (text !== undefined ? /^https?:\/\//i.test(text) : isStringValue(u)) r.out.push({ url: u, headers: at(args, source.headers) });
}

/** A transport construction (an HTTP one gives its URL and headers), or another client of the registry (its servers). */
function fromConstruction(c: Construction, r: Reader, depth: number): void {
  const transports = r.reg.endpoint?.transports ?? {};
  if (listedName(c, transports)) {
    r.out.push(fromTransport(c, transports));
    return;
  }
  const name = calledName(c) ?? "";
  const clients = r.reg.endpoint!.clients;
  if (Object.hasOwn(clients, name)) readClient({ name, source: clients[name]!, args: c.getArguments() as Expression[] }, r, depth + 1);
}

function readServers(e: Expression, spec: McpServersSource, source: Source, args: Expression[], r: Reader, depth: number): void {
  const u = unwrap(e);
  // `token ? { remote: {...} } : {}`: the servers of either branch
  if (Node.isConditionalExpression(u) && depth <= MAX_DEPTH) {
    for (const branch of [u.getWhenTrue(), u.getWhenFalse()]) readServers(branch, spec, source, args, r, depth + 1);
    return;
  }
  if (!spec.named) {
    const list = toArrayLiteral(e);
    if (!list) return readOne(e, spec, source, args, r, depth);
    for (const el of list.getElements()) {
      if (Node.isSpreadElement(el)) readServers(el.getExpression(), spec, source, args, r, depth + 1);
      else readOne(el, spec, source, args, r, depth + 1);
    }
    return;
  }
  for (const member of toObjectLiteral(e)?.getProperties() ?? []) {
    if (Node.isSpreadAssignment(member)) readServers(member.getExpression(), spec, source, args, r, depth + 1);
    const value = propertyValue(member);
    if (value) readOne(value, spec, source, args, r, depth + 1);
  }
}

interface BuiltClient {
  name: string;
  source: Source;
  args: Expression[];
}

function readClient({ name, source, args }: BuiltClient, r: Reader, depth: number): void {
  // a client of one server (`new MCPServerSSE({ url })`): its URL, and its transport when the client names one
  if (!source.servers) {
    const transport = transportOf(source.mcpTransport, name);
    r.out.push({ url: at(args, source.url), headers: at(args, source.headers), ...(transport ? { transport } : {}) });
    return;
  }
  const given = firstAt(args, source.servers.at);
  if (given && depth <= MAX_DEPTH) readServers(given, source.servers, source, args, r, depth);
}

/** The client construction a call is made on: the call itself (`new MultiServerMCPClient(...)`), else its receiver's. */
function clientOf(node: CallExpression | NewExpression, key: string, callee: Callee, reg: RegistryEntry): BuiltClient | undefined {
  const clients = reg.endpoint!.clients;
  if (Object.hasOwn(clients, key)) return { name: key, source: clients[key]!, args: node.getArguments() as Expression[] };
  for (const inst of [callee.instance, callee.rootInstance]) {
    const ctor = inst?.chain.at(-1);
    if (inst && ctor !== undefined && Object.hasOwn(clients, ctor)) return { name: ctor, source: clients[ctor]!, args: inst.args };
  }
  return undefined;
}

/**
 * One endpoint per HTTP server of the client the call is made on. A client the scan does not see (a parameter) is one
 * call to a server it cannot name when the registry's clients all speak HTTP, none when some may run a local process.
 */
export function mcpServerEndpoints(node: CallExpression | NewExpression, key: string, callee: Callee, reg: RegistryEntry): Endpoint[] {
  const client = clientOf(node, key, callee, reg);
  if (!client) return Object.values(reg.endpoint!.clients).some((c) => c.servers) ? [] : [{}];
  const r: Reader = { reg, out: [], budget: { left: 4 * MAX_SERVERS } };
  readClient(client, r, 0);
  return r.out;
}
