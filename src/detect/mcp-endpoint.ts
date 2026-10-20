import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import type { EndpointSource, MethodSpec, RegistryEntry } from "../types.js";
import { at, fromTransport, listedName, MAX_VISITS, transportsIn, type Construction, type Endpoint } from "./endpoint.js";

/**
 * The endpoint of an MCP client call (`@modelcontextprotocol/sdk`): a `Client` is built bare and given its transport
 * later, `client.connect(transport)`. Its calls go to the transports the same receiver is connected with in the file
 * (`client`, `this.client`), else to the transports the file builds. An HTTP transport (Streamable HTTP, SSE) gives
 * the server URL and its headers (`requestInit.headers`); a client that only reads as stdio, a WebSocket or an
 * in-memory pair sends no HTTP request and is not reported (`null`). Transports to several URLs leave the URL unknown.
 */

/** Two receivers of client methods that stand for the same client: the same variable, or the same `this.x` of a class. */
function sameReceiver(a: Expression, b: Expression): boolean {
  const [x, y] = [unwrap(a), unwrap(b)];
  if (Node.isIdentifier(x) && Node.isIdentifier(y)) {
    const [sx, sy] = [x.getSymbol(), y.getSymbol()];
    return sx !== undefined && sx === sy;
  }
  if (x.getText() !== y.getText()) return false;
  const cls = (n: Node) => n.getFirstAncestor((p) => Node.isClassDeclaration(p) || Node.isClassExpression(p));
  return x.getText().startsWith("this.") ? cls(x) === cls(y) : true;
}

function receiverOf(node: CallExpression | NewExpression): Expression | undefined {
  const callee = unwrap(node.getExpression());
  return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
}

/** The arguments of `<receiver>.connect(...)` calls in the file. */
function connected(node: CallExpression | NewExpression, method: string): Expression[] {
  const recv = receiverOf(node);
  if (!recv) return [];
  const out: Expression[] = [];
  for (const call of node.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrap(call.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== method) continue;
    const arg = call.getArguments()[0] as Expression | undefined;
    if (arg && sameReceiver(callee.getExpression(), recv)) out.push(arg);
  }
  return out;
}

function transportsOf(given: Expression[], names: Record<string, EndpointSource>): Construction[] {
  const found = new Set<Construction>();
  const budget = { left: MAX_VISITS, deep: true };
  for (const g of given) transportsIn(g, names, found, budget, 0);
  return [...found];
}

/** Every transport construction of the file. */
function fileTransports(node: Node, names: Record<string, EndpointSource>): Construction[] {
  const sf = node.getSourceFile();
  const nodes: Construction[] = [...sf.getDescendantsOfKind(SyntaxKind.NewExpression), ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)];
  return nodes.filter((c) => listedName(c, names) !== undefined);
}

/** The endpoint of the HTTP transports found, null when there are only others, empty when none is found. */
function fromTransports(found: Construction[], http: Record<string, EndpointSource>): Endpoint | null {
  const own = found.filter((c) => listedName(c, http) !== undefined);
  if (own.length === 0) return found.length > 0 ? null : {};
  const eps = own.map((c) => fromTransport(c, http));
  // Streamable HTTP with an SSE fallback to the same URL is one server, its transport either
  const url = eps[0]!.url?.getText();
  if (url === undefined || !eps.every((e) => e.url?.getText() === url)) return {};
  const kind = eps[0]!.transport?.kind;
  return eps.every((e) => e.transport?.kind === kind) ? eps[0]! : { ...eps[0]!, transport: undefined };
}

export function mcpEndpoint(node: CallExpression | NewExpression, reg: RegistryEntry, spec: MethodSpec, args: Expression[]): Endpoint | null {
  const ep = reg.endpoint!;
  const http = ep.transports ?? {};
  const names: Record<string, EndpointSource> = { ...http };
  for (const n of ep.nonHttp ?? []) if (!Object.hasOwn(names, n)) names[n] = {};
  // `client.connect(transport)`: only an HTTP transport makes it an MCP client's request
  if (spec.transportArg !== undefined) {
    const given = at(args, spec.transportArg);
    const found = given ? transportsOf([given], names) : [];
    return found.some((c) => listedName(c, http) !== undefined) ? fromTransports(found, http) : null;
  }
  const viaConnect = ep.connect ? transportsOf(connected(node, ep.connect), names) : [];
  return fromTransports(viaConnect.length > 0 ? viaConnect : fileTransports(node, names), http);
}
