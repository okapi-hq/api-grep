import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression, type Project } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import { declarationsOf, getProp } from "../ast/object.js";
import type { Callee, EndpointSource, MethodSpec, RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";
import { innerValues } from "./client-cache.js";
import { fetchEndpoint } from "./fetch-endpoint.js";

/**
 * The endpoint of a GraphQL client call (#54): the URL and headers given to the client's constructor
 * (`new GraphQLClient(url, { headers })`), or to the one transport handed to it (`new ApolloClient({ link: from([auth,
 * new HttpLink({ uri })]) })`). A call that names no client (a React hook, `useApolloClient()`) goes through the
 * project's client when the project builds exactly one; otherwise its endpoint stays unknown, never a guess.
 */

export interface Endpoint {
  url?: Expression;
  headers?: Expression;
  /** A URL the library builds itself (a node vendor's, #78): its host and the path before the method's. */
  host?: string;
  path?: string;
}

export type Construction = CallExpression | NewExpression;

/** Nodes visited while looking for a transport in a client's options, and identifier hops: bounds on hostile input. */
export const MAX_VISITS = 64;
export const MAX_DEPTH = 6;

/** `0`, `0.uri`, `0.fetchOptions.headers`: an argument, or a property of one. */
export function at(args: Expression[], where: string | undefined): Expression | undefined {
  if (where === undefined) return undefined;
  const [idx, ...props] = where.split(".");
  return props.reduce<Expression | undefined>((e, prop) => getProp(e, prop), args[Number(idx)]);
}

/** `new HttpLink(...)`, `apollo.HttpLink(...)`: the name called; none for anything else (`f()()`, an IIFE). */
export function calledName(c: Construction): string | undefined {
  const mc = memberChain(c.getExpression());
  return mc.chain.at(-1) ?? (Node.isIdentifier(mc.root) ? mc.root.getText() : undefined);
}

export const argsOf = (c: Construction): Expression[] => c.getArguments() as Expression[];

/** The name a construction is listed under in `names`: the name called (`HttpLink`), or its dotted path (`Network.create`). */
export function listedName(c: Construction, names: Record<string, unknown>): string | undefined {
  const name = calledName(c);
  if (name && Object.hasOwn(names, name)) return name;
  const mc = memberChain(c.getExpression());
  const dotted = Node.isIdentifier(mc.root) && mc.chain.length > 0 ? [mc.root.getText(), ...mc.chain].join(".") : undefined;
  return dotted && Object.hasOwn(names, dotted) ? dotted : undefined;
}

/** What a variable holds: its initializer, in this file or the one it is imported from. */
export function valueOf(e: Expression): Expression | undefined {
  for (const decl of declarationsOf(e)) {
    const target = Node.isImportSpecifier(decl) || Node.isImportClause(decl) ? e.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] : decl;
    if (target && Node.isVariableDeclaration(target)) return target.getInitializer();
  }
  return undefined;
}

/**
 * Transport constructions reachable from a client option: through variables, arrays, `from([...])`, `a.concat(b)`,
 * `split(...)`; with `deep`, also through object literals, functions, spreads and reassigned variables (#85).
 */
export function transportsIn(e: Expression, names: Record<string, EndpointSource>, out: Set<Construction>, budget: { left: number; deep?: boolean }, depth: number): void {
  if (--budget.left < 0 || depth > MAX_DEPTH) return;
  const u = unwrap(e);
  const inner = budget.deep ? innerValues(u) : undefined;
  if (inner) {
    for (const v of inner) transportsIn(v, names, out, budget, depth + 1);
    return;
  }
  if (Node.isIdentifier(u)) {
    const value = valueOf(u);
    if (value) transportsIn(value, names, out, budget, depth + 1);
    return;
  }
  if (Node.isArrayLiteralExpression(u)) {
    for (const el of u.getElements()) transportsIn(el, names, out, budget, depth + 1);
    return;
  }
  if (Node.isConditionalExpression(u)) {
    transportsIn(u.getWhenTrue(), names, out, budget, depth + 1);
    transportsIn(u.getWhenFalse(), names, out, budget, depth + 1);
    return;
  }
  if (!Node.isCallExpression(u) && !Node.isNewExpression(u)) return;
  if (listedName(u, names)) {
    out.add(u);
    return;
  }
  const callee = unwrap(u.getExpression());
  if (Node.isPropertyAccessExpression(callee)) transportsIn(callee.getExpression(), names, out, budget, depth + 1);
  for (const arg of argsOf(u)) transportsIn(arg, names, out, budget, depth + 1);
}

export function fromTransport(c: Construction, spec: Record<string, EndpointSource>): Endpoint {
  const name = listedName(c, spec);
  const source = name ? spec[name] : undefined;
  if (!source) return {};
  // Relay's `Network.create(fetchFn)`: the `fetch` the function sends
  if (source.fetchIn !== undefined) return fetchEndpoint(at(argsOf(c), source.fetchIn));
  return { url: at(argsOf(c), source.url), headers: at(argsOf(c), source.headers) };
}

/** The URL and headers a client construction gives: its own, else those of the one transport in its options. */
function fromClient(name: string, args: Expression[], reg: RegistryEntry): Endpoint {
  const source = Object.hasOwn(reg.endpoint?.clients ?? {}, name) ? reg.endpoint!.clients[name] : undefined;
  if (!source) return {};
  const url = at(args, source.url);
  if (url) return { url, headers: at(args, source.headers) };
  const transport = at(args, source.transport);
  const transports = reg.endpoint?.transports ?? {};
  if (!transport) return {};
  const found = new Set<Construction>();
  transportsIn(transport, transports, found, { left: MAX_VISITS }, 0);
  return found.size === 1 ? fromTransport([...found][0]!, transports) : {};
}

/** The client construction an expression holds (`useQuery(DOC, { client: adminClient })`). */
export function constructionOf(e: Expression | undefined, reg: RegistryEntry, depth = 0): Construction | undefined {
  if (!e || depth > MAX_DEPTH) return undefined;
  const u = unwrap(e);
  if (Node.isIdentifier(u)) return constructionOf(valueOf(u), reg, depth + 1);
  if (!Node.isCallExpression(u) && !Node.isNewExpression(u)) return undefined;
  return Object.hasOwn(reg.endpoint?.clients ?? {}, calledName(u) ?? "") ? u : undefined;
}

export const ofEntry = (pkg: string | undefined, reg: RegistryEntry): boolean =>
  !!pkg && [reg.package, ...(reg.aliases ?? [])].some((p) => p === pkg || (p.endsWith("/*") && pkg.startsWith(p.slice(0, -1))));

/** Every construction of the registry's clients and of transports from a package, with the endpoint each gives. */
function projectEndpoints(project: Project, reg: RegistryEntry): Endpoint[] {
  const spec = reg.endpoint!;
  const transports = spec.transports ?? {};
  // a client is built where its package is imported; a transport may come from another package
  const marks = [reg.package, ...(reg.aliases ?? []).map((a) => a.replace(/\/\*$/, "/")), ...Object.keys(transports)];
  const out: Endpoint[] = [];
  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) continue;
    const text = sf.getFullText();
    if (!marks.some((n) => text.includes(n))) continue;
    const nodes: Construction[] = [...sf.getDescendantsOfKind(SyntaxKind.NewExpression), ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)];
    for (const c of nodes) {
      const name = calledName(c) ?? "";
      const client = Object.hasOwn(spec.clients, name) ? spec.clients[name]! : undefined;
      const transport = client ? undefined : listedName(c, transports);
      if (!client && !transport) continue;
      const pkg = describeCallee(c).package;
      if (client && ofEntry(pkg, reg)) {
        const url = at(argsOf(c), client.url);
        if (url) out.push({ url, headers: at(argsOf(c), client.headers) });
      } else if (pkg && transport) {
        const t = fromTransport(c, transports);
        if (t.url) out.push(t);
      }
    }
  }
  return out;
}

const projectCache = new WeakMap<Project, Map<RegistryEntry, Endpoint>>();

/** The endpoint of the project's one client of this registry; none when it builds several or none. */
function projectEndpoint(project: Project, reg: RegistryEntry): Endpoint {
  let byEntry = projectCache.get(project);
  if (!byEntry) projectCache.set(project, (byEntry = new Map<RegistryEntry, Endpoint>()));
  let found = byEntry.get(reg);
  if (!found) {
    const all = projectEndpoints(project, reg);
    found = all.length === 1 ? all[0]! : {};
    byEntry.set(reg, found);
  }
  return found;
}

/** The URL and headers of a GraphQL client call; `args` are the method's arguments (after an endpoint given first). */
export function clientEndpoint(node: Node, reg: RegistryEntry, spec: MethodSpec, callee: Callee, args: Expression[]): Endpoint {
  if (spec.subscription || !reg.endpoint) return {};
  if (spec.clientArg !== undefined) {
    const given = at(args, spec.clientArg);
    const c = given ? constructionOf(given, reg) : undefined;
    if (c) return fromClient(calledName(c) ?? "", argsOf(c), reg);
    // an Apollo hook's `client` option names another client than the project's; Relay's environment is the app's
    if (given && !reg.endpoint.contextClient) return {};
  }
  for (const inst of [callee.instance, callee.rootInstance]) {
    // a default import (`import ApolloClient from "apollo-boost"`) has an empty chain
    const ctor = inst ? (inst.chain.at(-1) ?? "default") : undefined;
    if (inst && ctor !== undefined && Object.hasOwn(reg.endpoint.clients, ctor)) return fromClient(ctor, inst.args, reg);
  }
  return projectEndpoint(node.getProject(), reg);
}
