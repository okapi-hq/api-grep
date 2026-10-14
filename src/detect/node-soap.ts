import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { memberChain } from "../ast/expr.js";
import { isFunctionLike } from "../ast/function.js";
import { getProp } from "../ast/object.js";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { describeCallee, exportedChain } from "./callee.js";
import { writtenType } from "./type-annotation.js";

const FACTORIES = new Set(["createClient", "createClientAsync"]);

/** Methods of node-soap's `Client` that are not operations of the service. */
const CLIENT_METHODS = new Set([
  "addSoapHeader", "changeSoapHeader", "getSoapHeaders", "clearSoapHeaders", "addHttpHeader", "getHttpHeaders", "clearHttpHeaders",
  "addBodyAttribute", "getBodyAttributes", "clearBodyAttributes", "describe", "setEndpoint", "setSecurity", "setSOAPAction",
  "on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners", "listeners", "then", "catch", "toString",
]);

/** The factory a client comes from and its arguments; no factory for a client known from its declared type only. */
interface Origin {
  factory?: string;
  args: Expression[];
}

/** `soap.createClient(...)` / `createClientAsync(...)` from the soap package. */
function factoryCall(call: CallExpression): Origin | undefined {
  const c = describeCallee(call);
  const ch = exportedChain(c);
  return c.package === "soap" && ch.length === 1 && FACTORIES.has(ch[0]!) ? { factory: ch[0], args: call.getArguments() as Expression[] } : undefined;
}

/**
 * `soap.createClient(url, (err, client) => client.Track(...))`: the callback's `client` parameter. Read from the
 * syntax (the nearest enclosing function declaring the name), as it is tried on every member call of a file.
 */
function callbackClient(node: CallExpression): Origin | undefined {
  const root = memberChain(node.getExpression()).root;
  if (!Node.isIdentifier(root)) return undefined;
  const name = root.getText();
  const fn = node.getFirstAncestor((a) => isFunctionLike(a) && a.getParameters().some((p) => p.getName() === name));
  if (!isFunctionLike(fn) || fn.getParameters()[1]?.getName() !== name) return undefined;
  const call = fn.getParent();
  return call && Node.isCallExpression(call) && /createClient$/.test(call.getExpression().getText()) ? factoryCall(call) : undefined;
}

function clientOrigin(node: CallExpression, callee: Callee): Origin | undefined {
  if (callee.package !== "soap") return callbackClient(node);
  const inst = callee.instance;
  const factory = inst?.kind === "call" ? inst.chain[inst.chain.length - 1] : undefined;
  if (factory && FACTORIES.has(factory)) return { factory, args: inst!.args };
  // `client: soap.Client`, a client built where the scan cannot see
  const receiver = memberChain(node.getExpression()).nodes.at(-2);
  return callee.viaType && !inst && receiver && /(?:^|\.)Client\b/.test(writtenType(receiver)) ? { args: [] } : undefined;
}

/** `TrackAsync` -> `Track`; the operation is the last member of `client.Op` or `client.Service.Port.Op`. */
function operationOf(chain: string[]): string | undefined {
  if (chain.length !== 1 && chain.length !== 3) return undefined;
  const name = chain[chain.length - 1]!;
  if (chain.length === 1 && CLIENT_METHODS.has(name)) return undefined;
  const op = name.endsWith("Async") && name.length > 5 ? name.slice(0, -5) : name;
  return /^[A-Za-z_][\w.-]*$/.test(op) ? op : undefined;
}

/**
 * node-soap (#58): a client from `createClientAsync(wsdl, options, endpoint)` or `createClient(wsdl, options, cb,
 * endpoint)`, then `client.TrackAsync(args)` or `client.Track(args, cb)` (also through `Service.Port`). The address
 * is the `endpoint` argument or option when given.
 */
export function detectNodeSoap(node: CallExpression | NewExpression, callee: Callee, ctx: EvalCtx = {}): RawCall | null {
  if (!Node.isCallExpression(node)) return null;
  const chain = callee.package === "soap" ? callee.chain : memberChain(node.getExpression()).chain;
  const operation = operationOf(chain);
  const origin = operation ? clientOrigin(node, callee) : undefined;
  if (!operation || !origin) return null;
  const [wsdlExpr, options] = origin.args;
  // `createClientAsync(url, options, endpoint)`, `createClient(url, options, callback, endpoint)`
  const endpointArg = origin.args[origin.factory === "createClient" ? 3 : 2];
  const locationExpr = endpointArg ?? (options && !isFunctionLike(options) ? getProp(options, "endpoint", ctx) : undefined);
  return { node, client: "node-soap", impliedMethod: "POST", bodyExpr: (node.getArguments() as Expression[])[0], encoding: "xml", soap: { wsdlExpr, locationExpr, operation } };
}
