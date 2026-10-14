import { Node, SyntaxKind, type ClassDeclaration, type Expression } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import { declarationsOf } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import type { RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";
import { pickedByKey, type Built, type ClientValues } from "./client-cache.js";
import { argsOf, calledName, ofEntry, type Endpoint } from "./endpoint.js";
import { fromRpcClient } from "./rpc-endpoint.js";

/**
 * JSON-RPC clients picked from a cache (#85): each value the cache may hold is a client of the library (its endpoint),
 * a wallet or a socket (no HTTP request), or a provider class of the app built on the library's. Their call goes to
 * one endpoint only when every value agrees on it; a value picked with a key known at run time otherwise leaves the
 * host unknown, never the first entry of a table.
 */

const ofClients = (pkg: string | undefined, reg: RegistryEntry): boolean => (reg.endpoint?.clientPackage ? pkg === reg.endpoint.clientPackage : ofEntry(pkg, reg));

/** `extends JsonRpcProvider`: the library's class a class of the app extends, when it is one. */
function baseOf(cls: ClassDeclaration, reg: RegistryEntry): string | undefined {
  const base = cls.getExtends()?.getExpression();
  if (!base) return undefined;
  const mc = memberChain(base);
  if (!Node.isIdentifier(mc.root)) return undefined;
  const origin = identifierOrigin(mc.root);
  if (origin.kind !== "package" || !ofClients(origin.package, reg)) return undefined;
  return mc.chain.at(-1) ?? (origin.importedName && origin.importedName !== "default" && origin.importedName !== "*" ? origin.importedName : mc.root.getText());
}

/**
 * A provider class of the app: one that extends an HTTP client of the library sends over HTTP (it may override where,
 * so its URL is not read); one that extends a base class does when every client it builds is an HTTP one.
 */
function subclassEndpoint(cls: ClassDeclaration, reg: RegistryEntry): Endpoint | null | undefined {
  const spec = reg.endpoint!;
  const base = baseOf(cls, reg);
  if (!base) return undefined;
  if (spec.nonHttp?.includes(base)) return null;
  if (Object.hasOwn(spec.clients, base)) return {};
  if (!spec.types?.includes(base)) return undefined;
  const built = [...cls.getDescendantsOfKind(SyntaxKind.NewExpression), ...cls.getDescendantsOfKind(SyntaxKind.CallExpression)].map((c) => calledName(c) ?? "");
  if (built.some((n) => spec.nonHttp?.includes(n))) return null;
  return built.some((n) => Object.hasOwn(spec.clients, n)) ? {} : undefined;
}

/** What one value of a cache is: a client's endpoint, null when it is no HTTP client, undefined when it cannot be read. */
export function candidateEndpoint(c: Built, reg: RegistryEntry): Endpoint | null | undefined {
  const spec = reg.endpoint!;
  const name = calledName(c) ?? "";
  const callee = describeCallee(c);
  if (Object.hasOwn(spec.clients, name) && ofClients(callee.package, reg)) return fromRpcClient(name, argsOf(c), reg);
  if (spec.nonHttp?.includes(name) && ofClients(callee.package, reg)) return null;
  const cls = callee.localDecl;
  return cls && Node.isClassDeclaration(cls) ? subclassEndpoint(cls, reg) : undefined;
}

/** A URL's identity: a literal's value, the variable it names, else the node itself. */
function urlKey(e: Expression | undefined): unknown {
  const u = e ? unwrap(e) : undefined;
  if (!u) return undefined;
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return `"${u.getLiteralValue()}"`;
  return (Node.isIdentifier(u) ? declarationsOf(u)[0] : undefined) ?? u;
}

/** The one endpoint every value agrees on, else an unknown one (`{}`). */
export function agreedEndpoint(endpoints: Endpoint[], keyed: boolean): Endpoint {
  const first = endpoints[0];
  if (!first || (keyed && endpoints.some((e) => pickedByKey(e.url)))) return {};
  const same = (e: Endpoint): boolean => e.host === first.host && e.path === first.path && urlKey(e.url) === urlKey(first.url);
  return endpoints.every(same) ? first : {};
}

/** The endpoint of a client read from a cache: null when one of its values is not HTTP, undefined when one cannot be read. */
export function cachedEndpoint(found: ClientValues, reg: RegistryEntry): Endpoint | null | undefined {
  const endpoints: Endpoint[] = [];
  for (const c of found.values) {
    const e = candidateEndpoint(c, reg);
    if (e === undefined || e === null) return e;
    endpoints.push(e);
  }
  return agreedEndpoint(endpoints, found.keyed);
}
