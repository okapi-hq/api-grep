import { Node, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf } from "../ast/object.js";
import type { Callee, MethodSpec, RegistryEntry } from "../types.js";
import { readsOnly } from "./contract-abi.js";
import { argsOf, at, calledName, MAX_DEPTH, valueOf, type Construction, type Endpoint } from "./endpoint.js";
import { cachedClients } from "./client-cache.js";
import { agreedEndpoint, candidateEndpoint } from "./rpc-cache.js";
import { cachedProjectEndpoint, fromRpcClient, referenceName, rpcEndpoint } from "./rpc-endpoint.js";

/**
 * Contract objects of JSON-RPC client libraries (#78): `new ethers.Contract(address, abi, runner).balanceOf(owner)`,
 * web3.js `contract.methods.balanceOf(owner).call()`, viem `getContract({ client }).read.balanceOf([owner])`. The ABI
 * names their functions, so a registry key holds `*` for one; what goes on the wire is `eth_call`, `eth_estimateGas`
 * or a transaction, which the call says (`.call()`, `.read`, `.staticCall()`) or, for an ethers function called
 * directly, the ABI and the runner do. The function's name stays in the call's `sdk.chain`.
 */

/** Who signs what a contract sends: nobody (a provider, which only reads), the app, the node, or not known. */
type Signs = "none" | "local" | "node" | "unknown";

interface Runner {
  endpoint: Endpoint;
  signs: Signs;
}

export interface ContractCall {
  key: string;
  spec: MethodSpec;
  endpoint: Endpoint;
}

const TRANSACTIONS: Record<Signs, string[]> = {
  none: [],
  local: ["eth_sendRawTransaction"],
  node: ["eth_sendTransaction"],
  unknown: ["eth_sendRawTransaction", "eth_sendTransaction"],
};

const keysOf = new WeakMap<RegistryEntry, [string[], MethodSpec][]>();

function contractKeys(reg: RegistryEntry): [string[], MethodSpec][] {
  let keys = keysOf.get(reg);
  if (!keys) {
    keys = Object.entries(reg.methods ?? {}).flatMap(([k, s]) => (k.includes("*") || s.runnerArg !== undefined ? [[k.split("."), s] as [string[], MethodSpec]] : []));
    keysOf.set(reg, keys);
  }
  return keys;
}

/**
 * The contract key a call matches: `*` is one of the ABI's functions, never one of the object's own members. A key
 * read from the contract's construction (`runnerArg`) starts with its name and is called on it (`Contract.*`).
 */
function matchKey(callee: Callee, reg: RegistryEntry): { key: string; spec: MethodSpec; fn: string } | undefined {
  const not = reg.notFunctions ?? [];
  const chain = [...(callee.instance?.chain ?? []), ...callee.chain];
  for (const [p, spec] of contractKeys(reg)) {
    if (chain.length < p.length) continue;
    if (spec.runnerArg !== undefined && (callee.instance?.chain.at(-1) !== p[0] || callee.chain.length !== p.length - 1)) continue;
    const tail = chain.slice(-p.length);
    if (p.every((x, i) => (x === "*" ? !not.includes(tail[i]!) : x === tail[i]))) return { key: tail.join("."), spec, fn: tail[p.indexOf("*")] ?? "" };
  }
  return undefined;
}

/** `0.client.public|0.client`: the first of these places the construction fills. */
function firstAt(args: Expression[], where: string): Expression | undefined {
  for (const w of where.split("|")) {
    const e = at(args, w);
    if (e) return e;
  }
  return undefined;
}

/** A runner the scan does not follow (a parameter, a factory's result): the project's one client, as for a typed call (#52). */
function unseen(u: Expression, node: Construction, reg: RegistryEntry): Runner | null {
  const endpoint = cachedProjectEndpoint(node.getProject(), reg);
  if (!endpoint) return null;
  const decl = Node.isIdentifier(u) ? declarationsOf(u)[0] : undefined;
  const typed = decl && (Node.isParameterDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isVariableDeclaration(decl)) ? referenceName(decl.getTypeNode()) : undefined;
  return { endpoint, signs: typed && reg.endpoint!.types?.includes(typed) ? "none" : "unknown" };
}

/** `new Wallet(key, provider)`, `provider.getSigner()`: the provider's endpoint, signed by the app or by the node. */
function signerOf(c: Construction, node: Construction, reg: RegistryEntry, depth: number): Runner | null | undefined {
  const signers = reg.endpoint!.signers ?? {};
  const name = calledName(c) ?? "";
  const signer = Object.hasOwn(signers, name) ? signers[name]! : undefined;
  if (!signer) return undefined;
  const callee = unwrap(c.getExpression());
  const provider = signer.provider !== undefined ? at(argsOf(c), signer.provider) : Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
  const runner = runnerOf(provider, node, reg, depth + 1);
  return runner && { endpoint: runner.endpoint, signs: signer.signs };
}

/**
 * A runner read from a cache a helper fills (`getProvider(chainId)`, #85): each value's, combined; null when one is no
 * HTTP client, undefined when one cannot be read (or the expression reads no cache).
 */
function cachedRunner(u: Expression, node: Construction, reg: RegistryEntry, depth: number): Runner | null | undefined {
  const found = cachedClients(u);
  if (!found) return undefined;
  const runners: Runner[] = [];
  for (const c of found.values) {
    const signer = signerOf(c, node, reg, depth);
    const endpoint = signer === undefined ? candidateEndpoint(c, reg) : signer?.endpoint;
    if (endpoint === undefined || endpoint === null) return endpoint;
    runners.push({ endpoint, signs: signer?.signs ?? "none" });
  }
  const signs = runners.every((r) => r.signs === runners[0]!.signs) ? runners[0]!.signs : "unknown";
  return { endpoint: agreedEndpoint(runners.map((r) => r.endpoint), found.keyed), signs };
}

/** What an ethers contract is connected to; null when it is not an HTTP client (a browser wallet, a socket, none). */
function runnerOf(e: Expression | undefined, node: Construction, reg: RegistryEntry, depth: number): Runner | null {
  if (!e || depth > MAX_DEPTH) return null;
  const u = unwrap(e);
  if (Node.isIdentifier(u)) {
    const value = valueOf(u);
    if (value) return runnerOf(value, node, reg, depth + 1);
    const cached = cachedRunner(u, node, reg, depth);
    return cached !== undefined ? cached : unseen(u, node, reg);
  }
  if (Node.isCallExpression(u) || Node.isNewExpression(u)) {
    const name = calledName(u) ?? "";
    const spec = reg.endpoint!;
    if (Object.hasOwn(spec.clients, name)) {
      const endpoint = fromRpcClient(name, argsOf(u), reg);
      return endpoint && { endpoint, signs: "none" };
    }
    if (spec.nonHttp?.includes(name)) return null;
    const signer = signerOf(u, node, reg, depth);
    if (signer !== undefined) return signer;
  }
  const cached = cachedRunner(u, node, reg, depth);
  return cached !== undefined ? cached : unseen(u, node, reg);
}

/** What an ethers contract function sends: `eth_call` for a view, a transaction otherwise, both when the ABI does not say. */
function sent(kind: "auto" | "send", view: boolean | undefined, signs: Signs): string[] {
  const tx = TRANSACTIONS[signs];
  if (kind === "send" || view === false) return tx;
  return view || signs === "none" ? ["eth_call"] : ["eth_call", ...tx];
}

/**
 * A call on a contract object: its key, its spec with the RPC methods it sends, and its client's endpoint; null when it
 * sends nothing over HTTP (a wallet's contract), undefined when it is no contract call.
 */
export function contractCall(node: Construction, callee: Callee, reg: RegistryEntry): ContractCall | null | undefined {
  const m = reg.endpoint ? matchKey(callee, reg) : undefined;
  if (!m) return undefined;
  const { key, spec } = m;
  const args = callee.instance?.args ?? [];
  if (spec.runnerArg === undefined) {
    const endpoint = rpcEndpoint(node, reg, spec, callee, []);
    return endpoint && { key, spec, endpoint };
  }
  const given = firstAt(args, spec.runnerArg);
  if (!reg.endpoint!.signers) {
    const endpoint = given ? rpcEndpoint(node, reg, spec, callee, [], given) : null;
    return endpoint && { key, spec, endpoint };
  }
  const runner = runnerOf(given, node, reg, 0);
  const rpc = runner && spec.contract ? sent(spec.contract, readsOnly(at(args, spec.abiArg), m.fn), runner.signs) : spec.rpc;
  if (!runner || !rpc || rpc.length === 0) return null;
  return { key, spec: { ...spec, rpc }, endpoint: runner.endpoint };
}
