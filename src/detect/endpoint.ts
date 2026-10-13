import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression, type Project } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import { declarationsOf, getProp } from "../ast/object.js";
import type { Callee, EndpointSource, MethodSpec, RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";

/**
 * The endpoint of a GraphQL client call (#54): the URL and headers given to the client's constructor
 * (`new GraphQLClient(url, { headers })`), or to the one transport handed to it (`new ApolloClient({ link: from([auth,
 * new HttpLink({ uri })]) })`). A call that names no client (a React hook, `useApolloClient()`) goes through the
 * project's client when the project builds exactly one; otherwise its endpoint stays unknown, never a guess.
 */

export interface Endpoint {
  url?: Expression;
  headers?: Expression;
}

type Construction = CallExpression | NewExpression;

/** Nodes visited while looking for a transport in a client's options, and identifier hops: bounds on hostile input. */
const MAX_VISITS = 64;
const MAX_DEPTH = 6;

/** `0`, `0.uri`, `0.fetchOptions.headers`: an argument, or a property of one. */
function at(args: Expression[], where: string | undefined): Expression | undefined {
  if (where === undefined) return undefined;
  const [idx, ...props] = where.split(".");
  return props.reduce<Expression | undefined>((e, prop) => getProp(e, prop), args[Number(idx)]);
}

/** `new HttpLink(...)`, `apollo.HttpLink(...)`: the name called; none for anything else (`f()()`, an IIFE). */
function calledName(c: Construction): string | undefined {
  const mc = memberChain(c.getExpression());
  return mc.chain.at(-1) ?? (Node.isIdentifier(mc.root) ? mc.root.getText() : undefined);
}

const argsOf = (c: Construction): Expression[] => c.getArguments() as Expression[];

/** What a variable holds: its initializer, in this file or the one it is imported from. */
function valueOf(e: Expression): Expression | undefined {
  for (const decl of declarationsOf(e)) {
    const target = Node.isImportSpecifier(decl) || Node.isImportClause(decl) ? e.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] : decl;
    if (target && Node.isVariableDeclaration(target)) return target.getInitializer();
  }
  return undefined;
}

/** Transport constructions reachable from a client option: through variables, arrays, `from([...])`, `a.concat(b)`, `split(...)`. */
function transportsIn(e: Expression, names: Record<string, EndpointSource>, out: Set<Construction>, budget: { left: number }, depth: number): void {
  if (--budget.left < 0 || depth > MAX_DEPTH) return;
  const u = unwrap(e);
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
  const name = calledName(u);
  if (name && Object.hasOwn(names, name)) {
    out.add(u);
    return;
  }
  const callee = unwrap(u.getExpression());
  if (Node.isPropertyAccessExpression(callee)) transportsIn(callee.getExpression(), names, out, budget, depth + 1);
  for (const arg of argsOf(u)) transportsIn(arg, names, out, budget, depth + 1);
}

function fromTransport(c: Construction, spec: Record<string, EndpointSource>): Endpoint {
  const source = spec[calledName(c) ?? ""];
  return source ? { url: at(argsOf(c), source.url), headers: at(argsOf(c), source.headers) } : {};
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
function constructionOf(e: Expression | undefined, reg: RegistryEntry, depth = 0): Construction | undefined {
  if (!e || depth > MAX_DEPTH) return undefined;
  const u = unwrap(e);
  if (Node.isIdentifier(u)) return constructionOf(valueOf(u), reg, depth + 1);
  if (!Node.isCallExpression(u) && !Node.isNewExpression(u)) return undefined;
  return Object.hasOwn(reg.endpoint?.clients ?? {}, calledName(u) ?? "") ? u : undefined;
}

const ofEntry = (pkg: string | undefined, reg: RegistryEntry): boolean =>
  !!pkg && [reg.package, ...(reg.aliases ?? [])].some((p) => p === pkg || (p.endsWith("/*") && pkg.startsWith(p.slice(0, -1))));

/** Every construction of the registry's clients and of transports from a package, with the endpoint each gives. */
function projectEndpoints(project: Project, reg: RegistryEntry): Endpoint[] {
  const spec = reg.endpoint!;
  const names = [...Object.keys(spec.clients), ...Object.keys(spec.transports ?? {})];
  // a client is built where its package is imported; a transport may come from another package
  const marks = [reg.package, ...(reg.aliases ?? []).map((a) => a.replace(/\/\*$/, "/")), ...Object.keys(spec.transports ?? {})];
  const out: Endpoint[] = [];
  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary()) continue;
    const text = sf.getFullText();
    if (!marks.some((n) => text.includes(n))) continue;
    const nodes: Construction[] = [...sf.getDescendantsOfKind(SyntaxKind.NewExpression), ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)];
    for (const c of nodes) {
      const name = calledName(c) ?? "";
      if (!names.includes(name)) continue;
      const pkg = describeCallee(c).package;
      if (Object.hasOwn(spec.clients, name) && ofEntry(pkg, reg)) {
        const client = argsOf(c);
        const url = at(client, spec.clients[name]!.url);
        if (url) out.push({ url, headers: at(client, spec.clients[name]!.headers) });
      } else if (pkg && spec.transports && Object.hasOwn(spec.transports, name)) {
        const t = fromTransport(c, spec.transports);
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
export function clientEndpoint(node: Construction, reg: RegistryEntry, spec: MethodSpec, callee: Callee, args: Expression[]): Endpoint {
  if (spec.subscription || !reg.endpoint) return {};
  if (spec.clientArg !== undefined) {
    const given = at(args, spec.clientArg);
    if (given) {
      const c = constructionOf(given, reg);
      return c ? fromClient(calledName(c) ?? "", argsOf(c), reg) : {};
    }
  }
  for (const inst of [callee.instance, callee.rootInstance]) {
    // a default import (`import ApolloClient from "apollo-boost"`) has an empty chain
    const ctor = inst ? (inst.chain.at(-1) ?? "default") : undefined;
    if (inst && ctor !== undefined && Object.hasOwn(reg.endpoint.clients, ctor)) return fromClient(ctor, inst.args, reg);
  }
  return projectEndpoint(node.getProject(), reg);
}
