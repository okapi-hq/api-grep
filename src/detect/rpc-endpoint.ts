import { Node, SyntaxKind, type Expression, type Project, type TypeNode } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import type { Callee, EndpointSource, MethodSpec, RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";
import { urlOrNetwork, vendorEndpoint } from "./rpc-vendor.js";
import {
  argsOf,
  at,
  calledName,
  constructionOf,
  fromTransport,
  MAX_DEPTH,
  MAX_VISITS,
  ofEntry,
  transportsIn,
  valueOf,
  type Construction,
  type Endpoint,
} from "./endpoint.js";

/**
 * The endpoint of a JSON-RPC client call (#52): the URL a client is built with (`new Connection(url)`, `new
 * JsonRpcProvider(url)`), or the HTTP transport handed to it (viem `transport: http(url)`). These libraries also talk to
 * a browser wallet (`new BrowserProvider(window.ethereum)`, viem `custom(window.ethereum)`, `new Web3(window.ethereum)`)
 * and over sockets, which are no HTTP request of the app: a call is reported only when its client reads as HTTP, and
 * `null` says it does not.
 */

/** `"https://..."`, `` `${base}/rpc` ``, `process.env.RPC_URL`, a string variable: a URL rather than a provider object. */
function isUrlString(e: Expression, depth = 0): boolean {
  const u = unwrap(e);
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) || Node.isTemplateExpression(u)) return true;
  if (/^(?:process\.env|import\.meta\.env)\./.test(u.getText())) return true;
  if (depth >= MAX_DEPTH) return false;
  if (Node.isBinaryExpression(u)) {
    const op = u.getOperatorToken().getKind();
    const [l, r] = [u.getLeft(), u.getRight()];
    if (op === SyntaxKind.PlusToken) return isUrlString(l, depth + 1) || isUrlString(r, depth + 1);
    if (op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) return isUrlString(l, depth + 1) && isUrlString(r, depth + 1);
    return false;
  }
  const value = Node.isIdentifier(u) ? valueOf(u) : undefined;
  if (value) return isUrlString(value, depth + 1);
  const t = u.getType();
  return t.isString() || t.isStringLiteral() || t.isTemplateLiteral();
}

/** A client's construction: its URL, the one HTTP transport it is handed, or null when it does not read as HTTP. */
export function fromRpcClient(name: string, args: Expression[], reg: RegistryEntry): Endpoint | null {
  const spec = reg.endpoint!;
  const source = Object.hasOwn(spec.clients, name) ? spec.clients[name]! : undefined;
  if (!source) return null;
  if (source.vendor) return vendorEndpoint(source.vendor, args);
  if (source.urlOrNetwork) return urlOrNetwork(at(args, source.url));
  if (!source.transport) return { url: at(args, source.url), headers: at(args, source.headers) };
  const given = at(args, source.transport);
  if (!given) return null;
  const transports = spec.transports ?? {};
  const nonHttp = new Set(spec.nonHttp);
  const names: Record<string, EndpointSource> = { ...transports, ...Object.fromEntries([...nonHttp].map((n) => [n, {}])) };
  const found = new Set<Construction>();
  transportsIn(given, names, found, { left: MAX_VISITS }, 0);
  const all = [...found];
  if (all.some((c) => nonHttp.has(calledName(c) ?? ""))) return null;
  if (all.length === 1) return fromTransport(all[0]!, transports);
  if (all.length > 1) return {};
  // `new Web3(url)` takes a URL where it also takes a provider object
  const url = at(args, source.url);
  return url && isUrlString(url) ? { url } : null;
}

/**
 * The project's clients of the library, for a call that names none (a typed parameter): the one client's endpoint, an
 * unknown one when it builds several, null when one of them (or a wallet of the library) is not HTTP, or when it builds
 * none and the library also talks to wallets.
 */
function projectRpcEndpoint(project: Project, reg: RegistryEntry): Endpoint | null {
  const spec = reg.endpoint!;
  const nonHttp = spec.nonHttp ?? [];
  const marks = spec.clientPackage ? [spec.clientPackage] : [reg.package, ...(reg.aliases ?? [])];
  const ofClients = (pkg: string | undefined): boolean => (spec.clientPackage ? pkg === spec.clientPackage : ofEntry(pkg, reg));
  const out: Endpoint[] = [];
  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary() || !marks.some((m) => sf.getFullText().includes(m))) continue;
    const nodes: Construction[] = [...sf.getDescendantsOfKind(SyntaxKind.NewExpression), ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)];
    for (const c of nodes) {
      const name = calledName(c) ?? "";
      const client = Object.hasOwn(spec.clients, name);
      if ((!client && !nonHttp.includes(name)) || !ofClients(describeCallee(c).package)) continue;
      const endpoint = client ? fromRpcClient(name, argsOf(c), reg) : null;
      if (!endpoint) return null;
      out.push(endpoint);
    }
  }
  if (out.length === 0) return nonHttp.length > 0 ? null : {};
  return out.length === 1 ? out[0]! : {};
}

const projectCache = new WeakMap<Project, Map<RegistryEntry, Endpoint | null>>();

export function cachedProjectEndpoint(project: Project, reg: RegistryEntry): Endpoint | null {
  let byEntry = projectCache.get(project);
  if (!byEntry) projectCache.set(project, (byEntry = new Map<RegistryEntry, Endpoint | null>()));
  if (!byEntry.has(reg)) byEntry.set(reg, projectRpcEndpoint(project, reg));
  return byEntry.get(reg)!;
}

/** `ethers.Contract`, `PublicClient<Transport>`: the name of a written type reference, without namespace or arguments. */
export function referenceName(type: TypeNode | undefined): string | undefined {
  return type && Node.isTypeReference(type) ? type.getTypeName().getText().split(".").at(-1) : undefined;
}

/** The type names a call's receivers are declared with: as written, else as the checker names them. */
function receiverTypes(node: Construction): string[] {
  const nodes = memberChain(node.getExpression()).nodes.slice(0, -1);
  const out: string[] = [];
  for (const n of nodes) {
    const decl = n.getSymbol()?.getDeclarations()[0];
    const written = decl && (Node.isParameterDeclaration(decl) || Node.isVariableDeclaration(decl) || Node.isPropertyDeclaration(decl)) ? referenceName(decl.getTypeNode()) : undefined;
    const t = n.getType();
    const named = written ?? (t.getAliasSymbol() ?? t.getSymbol())?.getName();
    if (named && !named.startsWith("__")) out.push(named);
  }
  return out;
}

/** A call on a typed receiver is the library's client only when one of its types is: `token: Contract` is not. */
function clientTyped(node: Construction, reg: RegistryEntry): boolean {
  const types = reg.endpoint?.types;
  if (!types) return true;
  const declared = receiverTypes(node);
  return declared.length === 0 || declared.some((t) => types.includes(t));
}

/** The endpoint of a JSON-RPC client call, null when it is not an HTTP request of the app (see above). */
export function rpcEndpoint(node: Construction, reg: RegistryEntry, spec: MethodSpec, callee: Callee, args: Expression[], given?: Expression): Endpoint | null {
  const clients = reg.endpoint!.clients;
  const client = given ?? (spec.clientArg !== undefined ? at(args, spec.clientArg) : undefined);
  if (client) {
    const c = constructionOf(client, reg);
    return c ? fromRpcClient(calledName(c) ?? "", argsOf(c), reg) : cachedProjectEndpoint(node.getProject(), reg);
  }
  for (const inst of [callee.instance, callee.rootInstance]) {
    // a default import (`import Web3 from "web3"`) has an empty chain
    const ctor = inst ? (inst.chain.at(-1) ?? "default") : undefined;
    if (inst && ctor !== undefined && Object.hasOwn(clients, ctor)) return fromRpcClient(ctor, inst.args, reg);
  }
  if (callee.instance || !clientTyped(node, reg)) return null;
  return cachedProjectEndpoint(node.getProject(), reg);
}
