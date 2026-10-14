import { Node, SyntaxKind, type BindingElement, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { enclosingClass, fieldAssignments, parameterProperty } from "../ast/class.js";
import { memberChain, unwrap, type Chain } from "../ast/expr.js";
import { isFunctionLike, type FunctionLike } from "../ast/function.js";
import { declarationsOf, getProp, memberFunction } from "../ast/object.js";
import { identifierOrigin, packageFromSpecifier, packageOfType } from "../ast/origin.js";
import type { Callee, InstanceInfo } from "../types.js";
import { cacheRead, cachedClients } from "./client-cache.js";
import { annotatedPackage } from "./type-annotation.js";

const MAX_DEPTH = 6;

/** `import { get } from "axios"` (not the default or namespace import): the callee is that export, not the package itself. */
export function isNamedImport(c: Callee): boolean {
  return !!c.importedName && c.importedName !== "default" && c.importedName !== "*";
}

/** Chain as seen from the package's exports: named import name is prepended, default/namespace are not. */
export function exportedChain(c: Callee): string[] {
  return isNamedImport(c) ? [c.importedName!, ...c.chain] : c.chain;
}

/** Options given to the factory the client came from (`axios.create(cfg)`, `got.extend(cfg)`), when it is one of `factories`. */
export function factoryOptions(c: Callee, factories: string[]): Expression | undefined {
  const inst = c.instance;
  if (!inst || inst.kind !== "call") return undefined;
  const last = inst.chain[inst.chain.length - 1];
  return last !== undefined && factories.includes(last) ? inst.args[0] : undefined;
}

export function describeCallee(call: CallExpression | NewExpression, depth = 0): Callee {
  const expr = call.getExpression();
  const mc = memberChain(expr);
  return calleeFromChain(mc, depth);
}

/**
 * Libraries a page loads with a `<script>` tag and uses as globals, without a declaration the checker can see:
 * `axios.get(...)` after `<script src=".../axios.min.js">` is the axios package.
 */
const SCRIPT_TAG_GLOBALS: Record<string, string> = { axios: "axios", $: "jquery", jQuery: "jquery", supabase: "@supabase/supabase-js", Sentry: "@sentry/browser", posthog: "posthog-js", ky: "ky" };
/** Platform globals a project without the DOM / Node types does not declare. */
const PLATFORM_GLOBALS = new Set(["fetch", "XMLHttpRequest"]);

function undeclared(root: Expression, chain: string[]): Callee | undefined {
  const name = root.getText();
  const pkg = Object.hasOwn(SCRIPT_TAG_GLOBALS, name) ? SCRIPT_TAG_GLOBALS[name] : undefined;
  if (pkg) return { package: pkg, importedName: "*", chain };
  return PLATFORM_GLOBALS.has(name) ? { global: name, chain } : undefined;
}

/** `require("stripe")` used in place: `require("stripe")(key)`, `require("axios").get(url)`. */
function requiredPackage(root: Expression): string | undefined {
  if (!Node.isCallExpression(root) || root.getExpression().getText() !== "require") return undefined;
  const arg = root.getArguments()[0];
  return arg && Node.isStringLiteral(arg) ? (packageFromSpecifier(arg.getLiteralValue()) ?? undefined) : undefined;
}

function calleeFromChain(mc: Chain, depth: number): Callee {
  if (depth > MAX_DEPTH) return { chain: mc.chain };
  const { root, chain } = mc;
  if (Node.isIdentifier(root)) {
    const o = identifierOrigin(root);
    if (o.kind === "package") return { package: o.package, importedName: o.importedName, chain };
    if (o.kind === "global") return { global: o.name, chain };
    if (o.kind === "local") return localCallee(o.decl, mc, depth);
    return (!root.getSymbol() ? undeclared(root, chain) : undefined) ?? typeFallback(mc, 0);
  }
  if (Node.isThisExpression(root)) return thisCallee(mc, depth);
  const required = requiredPackage(root);
  if (required) return { package: required, importedName: "default", chain };
  if (Node.isCallExpression(root) || Node.isNewExpression(root)) return instanceCallee(root, chain, depth);
  return typeFallback(mc, 0);
}

/** The call or construction an expression is, or the one a local variable it names was initialized with. */
function constructed(expr: Expression | undefined): CallExpression | NewExpression | undefined {
  let u = expr ? unwrap(expr) : undefined;
  if (u && Node.isIdentifier(u)) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    u = init ? unwrap(init) : undefined;
  }
  return u && (Node.isCallExpression(u) || Node.isNewExpression(u)) ? u : undefined;
}

/** The local function a call runs: `make()`, a method of a local class, a member of a local object (`providers.online.make()`). */
function calledFunction(inner: Callee): FunctionLike | undefined {
  const own = wrapperFunction(inner);
  if (own) return own;
  const decl = inner.localDecl;
  const member = decl && Node.isVariableDeclaration(decl) && inner.chain.length > 0 ? memberFunction(decl.getInitializer(), inner.chain) : undefined;
  return isFunctionLike(member) ? member : undefined;
}

/**
 * `const api = createClient()` where the local factory returns `axios.create(...)` / `new Stripe(...)`; or an object
 * holding the client, whose property the caller reads (`const { client } = await providers.online.make()`, where
 * `make` returns `{ client, session }`).
 */
function factoryReturn(inner: Callee, chain: string[], depth: number): Callee | undefined {
  const fn = depth <= MAX_DEPTH ? calledFunction(inner) : undefined;
  const body = fn?.getBody?.();
  if (!body) return undefined;
  const returned = Node.isExpression(body) ? [body] : body.getDescendantsOfKind(SyntaxKind.ReturnStatement).flatMap((r) => r.getExpression() ?? []);
  for (const expr of returned) {
    const u = constructed(expr);
    // `let p = cache.get(k)`: a cache entry, read below
    if (u && !(Node.isCallExpression(u) && cacheRead(u))) {
      const c = describeCallee(u, depth + 1);
      if (c.package || c.global) return { ...c, instance: instanceOf(u, c), chain };
      continue;
    }
    const held = chain.length > 1 ? constructed(getProp(expr, chain[0]!)) : undefined;
    const c = held ? instanceCallee(held, chain.slice(1), depth + 1) : undefined;
    if (c?.package) return c;
  }
  return fromCache(returned, chain, depth);
}

const instanceOf = (u: CallExpression | NewExpression, c: Callee): InstanceInfo => ({ kind: Node.isNewExpression(u) ? "new" : "call", chain: exportedChain(c), args: u.getArguments() as Expression[] });

/**
 * `return providers[chainId]` where the helper fills the cache (#85): the package of the clients it holds, all of
 * them kept for the endpoint (`cached`); the other values may be classes of the app built on that package's.
 */
function fromCache(returned: Expression[], chain: string[], depth: number): Callee | undefined {
  for (const expr of returned) {
    const found = cachedClients(expr);
    const described = found?.values.map((v) => [v, describeCallee(v, depth + 1)] as const) ?? [];
    const packaged = described.filter(([, c]) => c.package);
    const first = packaged[0];
    if (!first || packaged.some(([, c]) => c.package !== first[1].package)) continue;
    return { ...first[1], instance: instanceOf(first[0], first[1]), chain, cached: found };
  }
  return undefined;
}

function instanceCallee(init: CallExpression | NewExpression, chain: string[], depth: number): Callee {
  const inner = describeCallee(init, depth + 1);
  const viaFactory = factoryReturn(inner, chain, depth);
  if (viaFactory) return viaFactory;
  return {
    package: inner.package,
    importedName: inner.importedName,
    global: inner.global,
    localDecl: inner.localDecl,
    viaType: inner.viaType,
    instance: {
      kind: Node.isNewExpression(init) ? "new" : "call",
      chain: exportedChain(inner),
      args: init.getArguments() as Expression[],
    },
    rootInstance: inner.rootInstance ?? inner.instance,
    chain,
  };
}

/** Initializer of a local; a parameter's default (`fetchImpl = fetch`) counts, since it is what runs unless overridden. */
function initializerOf(decl: Node): Expression | undefined {
  if (Node.isVariableDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isBindingElement(decl) || Node.isParameterDeclaration(decl)) {
    return decl.getInitializer();
  }
  if (Node.isPropertyAssignment(decl)) return decl.getInitializer();
  return undefined;
}

function localCallee(decl: Node, mc: Chain, depth: number): Callee {
  const { chain } = mc;
  if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl) || Node.isClassDeclaration(decl)) {
    return { localDecl: decl, chain };
  }
  const init = initializerOf(decl);
  if (init) {
    const u = unwrap(init);
    if (Node.isArrowFunction(u) || Node.isFunctionExpression(u)) return { localDecl: u, chain };
    if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, chain, depth);
    if (Node.isIdentifier(u) || Node.isPropertyAccessExpression(u)) {
      const inner = memberChain(u);
      const merged: Chain = { root: inner.root, nodes: [...inner.nodes, ...mc.nodes.slice(1)], chain: [...inner.chain, ...chain] };
      const c = calleeFromChain(merged, depth + 1);
      return c.viaType ? typeFallback(mc, 0) : c;
    }
  }
  const typed = typeFallback(mc, 0, decl);
  return typed.package || !Node.isBindingElement(decl) ? typed : (destructuredCallee(decl, chain, depth) ?? typed);
}

/**
 * `const { admin } = await authenticate.admin(request)`: a property of what a call returns stands, when no type says
 * what it is (the package's types are not installed), for that call's result and the property (`admin.graphql`).
 */
function destructuredCallee(decl: BindingElement, chain: string[], depth: number): Callee | undefined {
  const pattern = decl.getParent();
  const owner = pattern.getParent();
  if (decl.getDotDotDotToken() || !Node.isObjectBindingPattern(pattern) || !Node.isVariableDeclaration(owner)) return undefined;
  const nameNode = decl.getPropertyNameNode() ?? decl.getNameNode();
  const init = owner.getInitializer();
  const u = init ? unwrap(init) : undefined;
  if (!Node.isIdentifier(nameNode) || !u || (!Node.isCallExpression(u) && !Node.isNewExpression(u))) return undefined;
  const c = instanceCallee(u, [nameNode.getText(), ...chain], depth + 1);
  return c.package ? c : undefined;
}

function thisCallee(mc: Chain, depth: number): Callee {
  const { root, chain } = mc;
  const cls = enclosingClass(root);
  const propName = chain[0];
  if (!cls || !propName) return { ...typeFallback(mc, 1), thisRoot: true };
  const prop = cls.getProperty(propName);
  const method = cls.getMethod(propName);
  if (method) return { localDecl: method, chain: chain.slice(1) };
  const rest: Chain = { root: mc.nodes[1] ?? root, nodes: mc.nodes.slice(1), chain: chain.slice(1) };
  if (prop?.getInitializer()) return localCallee(prop, rest, depth + 1);
  const paramProp = parameterProperty(cls, propName);
  if (paramProp?.getInitializer()) return localCallee(paramProp, rest, depth + 1);
  // `this._stripe = null` in the constructor, `this._stripe = new Stripe(key)` in `configure()`: the one that builds
  const built = fieldAssignments(cls, propName)
    .map(unwrap)
    .find((u) => Node.isCallExpression(u) || Node.isNewExpression(u));
  if (built && (Node.isCallExpression(built) || Node.isNewExpression(built))) return instanceCallee(built, rest.chain, depth + 1);
  return { ...typeFallback(mc, 1), thisRoot: true };
}

/**
 * Walks chain prefixes and returns the first whose static type is declared in a node_modules package; when the
 * package's types are not installed, the written annotation (`db: SupabaseClient`) is traced to its import instead.
 */
function typeFallback(mc: Chain, startIndex: number, decl?: Node): Callee {
  const nodes = mc.nodes;
  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i]!;
    const pkg = packageOfType(node.getType());
    if (pkg) return { package: pkg, chain: mc.chain.slice(i), viaType: true };
  }
  if (decl && (Node.isParameterDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isVariableDeclaration(decl))) {
    const pkg = packageOfType(decl.getType());
    if (pkg) return { package: pkg, chain: mc.chain, viaType: true };
  }
  for (let i = startIndex; i < nodes.length; i++) {
    const pkg = annotatedPackage(nodes[i]!);
    if (pkg) return { package: pkg, chain: mc.chain.slice(i), viaType: true };
  }
  return { chain: mc.chain, localDecl: decl && Node.isParameterDeclaration(decl) ? undefined : decl };
}

/** What `mc` calls when its root stands for `value`: a caller's argument for an untyped parameter (`ask(client)`). */
export function calleeThrough(value: Expression, mc: Chain): Callee {
  const u = unwrap(value);
  if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, mc.chain, 1);
  const inner = memberChain(u);
  return calleeFromChain({ root: inner.root, nodes: [...inner.nodes, ...mc.nodes.slice(1)], chain: [...inner.chain, ...mc.chain] }, 1);
}

/** `fn.call(this, ...args)` invokes `fn` with the arguments shifted by one. */
export function callShift(callee: Callee): number {
  return callee.chain.length === 1 && callee.chain[0] === "call" && isFunctionLike(callee.localDecl) ? 1 : 0;
}

/** The function a call resolves to: a local function (also through `.call(this, …)`), or a method of a local class (`svc.post`, `Svc.post`). */
export function wrapperFunction(callee: Callee): FunctionLike | undefined {
  const d = callee.localDecl;
  if (isFunctionLike(d) && (callee.chain.length === 0 || callShift(callee) === 1)) return d;
  if (d && (Node.isClassDeclaration(d) || Node.isClassExpression(d)) && callee.chain.length === 1) {
    const m = d.getMethod(callee.chain[0]!);
    return isFunctionLike(m) ? m : undefined;
  }
  return undefined;
}
