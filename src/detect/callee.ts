import { Node, SyntaxKind, type BindingElement, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { assignedConstruction } from "../ast/assigned.js";
import { assignedModule, loadedModule } from "../ast/loaded-module.js";
import { enclosingClass, fieldAssignments, methodOf, parameterProperty } from "../ast/class.js";
import { guardedValue, isNothing, memberChain, unwrap, type Chain } from "../ast/expr.js";
import { isFunctionLike, nestedReturnsOf, returnsOf, type FunctionLike } from "../ast/function.js";
import { declarationsOf, getProp, memberFunction } from "../ast/object.js";
import { identifierOrigin, packageFromSpecifier, packageOfType } from "../ast/origin.js";
import { memoValue } from "../ast/react.js";
import type { Callee, InstanceInfo } from "../types.js";
import { cacheRead, cachedClients } from "./client-cache.js";
import { functionCallee } from "./fn-value.js";
import { heldValue, hookValues, namedValue } from "./held.js";
import { injectedFunctions } from "./injected-fn.js";
import { annotatedPackage } from "./type-annotation.js";
import { typechainContract } from "./typechain.js";
import { sdkPackages } from "../normalize/provider.js";

const NPM_SDKS = sdkPackages("npm");

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
  const c = calleeFromChain(mc, depth);
  return depth === 0 && Node.isCallExpression(call) && !wrapperFunction(c) ? (functionCallee(expr, c) ?? c) : c;
}


/**
 * Libraries a page loads with a `<script>` tag and uses as globals, without a declaration the checker can see:
 * `axios.get(...)` after `<script src=".../axios.min.js">` is the axios package.
 */
const SCRIPT_TAG_GLOBALS: Record<string, string> = { axios: "axios", $: "jquery", jQuery: "jquery", supabase: "@supabase/supabase-js", Sentry: "@sentry/browser", posthog: "posthog-js", ky: "ky" };
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
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

/** `window.supabase.createClient(...)`: a script-tag global read through the global object, when nothing declares it. */
function windowGlobal(mc: Chain): Callee | undefined {
  const [name, ...rest] = mc.chain;
  if (!name || !GLOBAL_OBJECTS.has(mc.root.getText()) || !Object.hasOwn(SCRIPT_TAG_GLOBALS, name) || mc.nodes[1]?.getSymbol()) return undefined;
  return { package: SCRIPT_TAG_GLOBALS[name], importedName: "*", chain: rest };
}

function calleeFromChain(mc: Chain, depth: number): Callee {
  if (depth > MAX_DEPTH) return { chain: mc.chain };
  const { root, chain } = mc;
  const viaWindow = windowGlobal(mc);
  if (viaWindow) return viaWindow;
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

/**
 * The call or construction an expression is, or the one a local variable it names was initialized with; a memoized
 * value (`useMemo(() => new Client(url), deps)`) is the value itself.
 */
function constructed(expr: Expression | undefined): CallExpression | NewExpression | undefined {
  let u = expr ? guardedValue(expr) : undefined;
  if (u && Node.isIdentifier(u)) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    u = init ? guardedValue(memoValue(init)) : undefined;
    // `let client; ... client = new OpenAI()`: the construction it is given later
    if ((!u || !(Node.isCallExpression(u) || Node.isNewExpression(u))) && decl && Node.isVariableDeclaration(decl)) u = assignedConstruction(decl);
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
  if (!fn?.getBody?.()) return undefined;
  // a factory returning one of several packages' clients (`await import("@vendor/bedrock-sdk")` on one path): an API
  // SDK the providers know is preferred to a package they do not, which stays the answer when no such SDK follows
  let unknown: Callee | undefined;
  for (const expr of nestedReturnsOf(fn)) {
    const c = returnedCallee(expr, chain, depth);
    if (!c) continue;
    if (!c.package || NPM_SDKS.has(c.package)) return c;
    unknown ??= c;
  }
  return unknown ?? fromCache(returnsOf(fn), chain, depth);
}

/** What one `return` of a local factory hands out, when it is a package's client. */
function returnedCallee(expr: Expression, chain: string[], depth: number): Callee | undefined {
  // `return Purchases` where the module holds the SDK it loaded on demand
  const named = guardedValue(expr);
  const module = Node.isIdentifier(named) ? loadedModuleCallee(named, chain) : undefined;
  if (module) return module;
  const u = constructed(expr);
  // `return useContext(RpcContext)` in the app's own hook (#98)
  const hook = u ? hookCallee(u, chain, depth + 1) : undefined;
  if (hook?.package) return hook;
  // `let p = cache.get(k)`: a cache entry, read by `fromCache`
  if (u && !hook && !(Node.isCallExpression(u) && cacheRead(u))) {
    const c = describeCallee(u, depth + 1);
    return c.package || c.global ? { ...c, instance: instanceOf(u, c), chain } : undefined;
  }
  const held = chain.length > 1 ? constructed(getProp(expr, chain[0]!)) : undefined;
  const c = held ? instanceCallee(held, chain.slice(1), depth + 1) : undefined;
  return c?.package ? c : undefined;
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
  const typechain = typechainContract(init, chain);
  if (typechain) return typechain;
  const handed = depth <= MAX_DEPTH ? (hookCallee(init, chain, depth) ?? injectedCallee(init, chain, depth)) : undefined;
  if (handed) return handed;
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

/** `useMemo(() => client, deps)` is the client; `useContext(Ctx)` the value of the app's `<Ctx.Provider value>` (#98). */
function hookCallee(init: CallExpression | NewExpression, chain: string[], depth: number): Callee | undefined {
  const values = Node.isCallExpression(init) ? hookValues(init) : undefined;
  return values && values.length > 0 ? agreedCallee(values, chain, depth + 1) : undefined;
}

/** What `chain` calls on a value: a construction's member, else what the identifier it is names. */
function valueCallee(value: Expression, chain: string[], depth: number): Callee {
  const u = constructed(value);
  if (u) return instanceCallee(u, chain, depth);
  const id = namedValue(value);
  return id ? calleeFromChain({ root: id, nodes: [id], chain }, depth) : { chain };
}

/** What `chain` calls on each value a hook hands out: one client, or several of one package kept for the endpoint. */
function agreedCallee(values: Expression[], chain: string[], depth: number): Callee | undefined {
  const held = values.map((v) => heldValue(v, chain));
  const found = held.map((h) => valueCallee(h.value, h.chain, depth));
  const first = found[0]!;
  if (found.length === 1) return first;
  if (!first.package || found.some((c) => c.package !== first.package)) return undefined;
  const built = held.map((h) => constructed(h.value));
  const distinct = [...new Set(built)];
  if (distinct.some((b) => !b)) return undefined;
  return distinct.length === 1 ? first : { ...first, cached: { values: distinct as (CallExpression | NewExpression)[], keyed: false } };
}

/** `this.getProvider(chainId)` where the constructor is handed the function (#98): what the functions passed return. */
function injectedCallee(init: CallExpression | NewExpression, chain: string[], depth: number): Callee | undefined {
  const fns = Node.isCallExpression(init) ? injectedFunctions(init) : undefined;
  if (!fns) return undefined;
  // a cache the functions fill: every client in it
  const cached = fromCache([init], chain, depth);
  if (cached) return cached;
  const found = fns.map((fn) => factoryReturn({ localDecl: fn, chain: [] }, chain, depth));
  const first = found[0];
  const args = (c: Callee | undefined): string => (c?.instance?.args ?? []).map((a) => a.getText()).join(",");
  return first?.package && found.every((c) => c?.package === first.package && args(c) === args(first)) ? first : undefined;
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
    const u = guardedValue(init);
    if (Node.isArrowFunction(u) || Node.isFunctionExpression(u)) return { localDecl: u, chain };
    if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, chain, depth);
    if (Node.isIdentifier(u) || Node.isPropertyAccessExpression(u)) {
      const inner = memberChain(u);
      const merged: Chain = { root: inner.root, nodes: [...inner.nodes, ...mc.nodes.slice(1)], chain: [...inner.chain, ...chain] };
      const c = calleeFromChain(merged, depth + 1);
      return c.viaType ? typeFallback(mc, 0) : c;
    }
    // `const ctx = { provider: new JsonRpcProvider(url) }`: a client held in a context object (#85)
    const held = Node.isObjectLiteralExpression(u) && chain.length > 1 ? constructed(getProp(u, chain[0]!)) : undefined;
    const c = held ? instanceCallee(held, chain.slice(1), depth + 1) : undefined;
    if (c?.package) return c;
  }
  const module = Node.isIdentifier(mc.root) && (Node.isVariableDeclaration(decl) || Node.isParameterDeclaration(decl)) ? loadedModuleCallee(mc.root, chain) : undefined;
  if (module) return module;
  const assigned = Node.isVariableDeclaration(decl) ? assignedConstruction(decl) : undefined;
  if (assigned) return instanceCallee(assigned, chain, depth);
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
  const method = methodOf(cls, propName);
  if (method) return { localDecl: method, chain: chain.slice(1) };
  const rest: Chain = { root: mc.nodes[1] ?? root, nodes: mc.nodes.slice(1), chain: chain.slice(1) };
  const init = prop?.getInitializer();
  // `private client: X | null = null`, set later in a method: the assignments below say what it holds
  if (prop && init && !isNothing(unwrap(init))) return localCallee(prop, rest, depth + 1);
  const paramProp = parameterProperty(cls, propName);
  if (paramProp?.getInitializer()) return localCallee(paramProp, rest, depth + 1);
  // `this._stripe = null` in the constructor, `this._stripe = new Stripe(key)` in `configure()`: the one that builds
  const built = fieldAssignments(cls, propName)
    .map(guardedValue)
    .find((u) => Node.isCallExpression(u) || Node.isNewExpression(u));
  if (built && (Node.isCallExpression(built) || Node.isNewExpression(built))) return instanceCallee(built, rest.chain, depth + 1);
  // `const sdk = loadSdk(); this.sentry = sdk`: the client the local names
  for (const value of depth < MAX_DEPTH ? fieldAssignments(cls, propName).map(guardedValue) : []) {
    const c = Node.isIdentifier(value) ? calleeFromChain({ root: value, nodes: [value, ...rest.nodes.slice(1)], chain: rest.chain }, depth + 1) : undefined;
    if (c?.package) return c;
  }
  return { ...typeFallback(mc, 1), thisRoot: true };
}

/**
 * An SDK module loaded on demand (`ast/loaded-module.ts`): a `let` given `require("pkg").default` later in its file, the
 * module an `import("pkg").then((mod) => ...)` callback is handed.
 */
function loadedModuleCallee(id: Expression, chain: string[]): Callee | undefined {
  const decl = declarationsOf(id)[0];
  const m = (decl && Node.isVariableDeclaration(decl) ? assignedModule(decl) : undefined) ?? loadedModule(id);
  return m ? { package: m.package, importedName: m.importedName, chain } : undefined;
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
  // a parameter, or a piece of one (`({ client }) => ...`), is what the callers pass: no local value
  const handed = decl && (Node.isParameterDeclaration(decl) || (Node.isBindingElement(decl) && !!decl.getFirstAncestorByKind(SyntaxKind.Parameter)));
  return { chain: mc.chain, localDecl: handed ? undefined : decl };
}

/** What `mc` calls when its root stands for `value`: a caller's argument for an untyped parameter (`ask(client)`). */
export function calleeThrough(value: Expression, mc: Chain): Callee {
  const u = unwrap(value);
  if (Node.isCallExpression(u) || Node.isNewExpression(u)) return instanceCallee(u, mc.chain, 1);
  // `run({ provider })`: the client the object holds (#98)
  if (Node.isObjectLiteralExpression(u)) {
    const held = heldValue(u, mc.chain);
    return held.value !== u ? valueCallee(held.value, held.chain, 1) : { chain: mc.chain };
  }
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
  // `const send = makeSender(base); send(path)` calls what `makeSender` returned, not `makeSender`
  if (isFunctionLike(d) && callee.instance?.kind !== "call" && (callee.chain.length === 0 || callShift(callee) === 1)) return d;
  if (d && (Node.isClassDeclaration(d) || Node.isClassExpression(d)) && callee.chain.length === 1) {
    const m = methodOf(d, callee.chain[0]!);
    return isFunctionLike(m) ? m : undefined;
  }
  return undefined;
}
