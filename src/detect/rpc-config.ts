import { Node, SyntaxKind, type Expression, type JsxOpeningElement, type JsxSelfClosingElement, type Project } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp, toObjectLiteral } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import type { ClientSource, RegistryEntry } from "../types.js";
import { describeCallee } from "./callee.js";
import { returnsOf } from "../ast/function.js";
import { agreedEndpoint } from "./rpc-cache.js";
import { argsOf, at, calledName, constructionOf, MAX_DEPTH, ofEntry, valueOf, type Construction, type Endpoint } from "./endpoint.js";
import { cachedProjectEndpoint, fromRpcClient } from "./rpc-endpoint.js";

/**
 * Configs of JSON-RPC clients (wagmi, #85): `createConfig({ transports })`, or its `client({ chain })` option, which
 * returns the client built for each chain. Hooks, actions and `usePublicClient()` send through the config they are
 * given, else the project's one config.
 */

/**
 * The options a client takes its transports from: the first of `where`'s places (`0.transports|0.client`) the
 * construction fills, a method written in the options object (`client({ chain }) { ... }`) as the values it returns.
 */
export function optionValues(args: Expression[], where: string, deep: boolean): Expression[] {
  for (const w of where.split("|")) {
    const value = at(args, w);
    if (value) return [value];
    const path = w.split(".");
    const owner = deep && path.length > 1 ? toObjectLiteral(at(args, path.slice(0, -1).join("."))) : undefined;
    const method = owner?.getProperty(path.at(-1)!);
    if (method && Node.isMethodDeclaration(method)) return returnsOf(method);
  }
  return [];
}

type Component = NonNullable<ClientSource["component"]>;

/** `endpoint={url}`, `config={{ httpHeaders }}`: a prop's value, or a property of one (`config.httpHeaders`). */
function propValue(el: JsxOpeningElement | JsxSelfClosingElement, where: string | undefined): Expression | undefined {
  const [name, ...rest] = where?.split(".") ?? [];
  const attr = name ? el.getAttribute(name) : undefined;
  const init = attr && Node.isJsxAttribute(attr) ? attr.getInitializer() : undefined;
  const value = init && Node.isJsxExpression(init) ? init.getExpression() : init && Node.isStringLiteral(init) ? init : undefined;
  return rest.reduce<Expression | undefined>((e, key) => getProp(e, key), value);
}

/** The project's JSX elements of a component the registry's package exports (`<ConnectionProvider>`). */
function elementsOf(project: Project, name: string, reg: RegistryEntry): (JsxOpeningElement | JsxSelfClosingElement)[] {
  const out: (JsxOpeningElement | JsxSelfClosingElement)[] = [];
  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary() || !sf.getFullText().includes(name)) continue;
    for (const el of [...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      const tag = el.getTagNameNode();
      const origin = Node.isIdentifier(tag) && tag.getText() === name ? identifierOrigin(tag) : undefined;
      if (origin?.kind === "package" && ofEntry(origin.package, reg)) out.push(el);
    }
  }
  return out;
}

const byComponent = new WeakMap<Project, Map<string, Endpoint>>();

/**
 * The client a context provider builds from its props (`<ConnectionProvider endpoint={url}>`): the project's one such
 * element, of the registry's package; an unknown endpoint when it renders several or none.
 */
export function componentEndpoint(project: Project, comp: Component, reg: RegistryEntry): Endpoint {
  let known = byComponent.get(project);
  if (!known) byComponent.set(project, (known = new Map<string, Endpoint>()));
  const cached = known.get(`${reg.package}:${comp.name}`);
  if (cached) return cached;
  const found = elementsOf(project, comp.name, reg).map((el) => ({ url: propValue(el, comp.url), headers: propValue(el, comp.headers) }));
  const out = found.length === 1 ? found[0]! : {};
  known.set(`${reg.package}:${comp.name}`, out);
  return out;
}

/**
 * The configs the app hands its context provider (`<WagmiProvider config={config}>`): the endpoint they agree on;
 * null when one cannot be read (a config built by another library) or is not HTTP; undefined when it renders none.
 */
export function providedEndpoint(project: Project, reg: RegistryEntry): Endpoint | null | undefined {
  const given = reg.endpoint?.contextProvider;
  const elements = given ? elementsOf(project, given.name, reg) : [];
  if (!given || elements.length === 0) return undefined;
  const endpoints: Endpoint[] = [];
  for (const el of elements) {
    const value = propValue(el, given.prop);
    for (const choice of value ? choices(value) : [undefined]) {
      const c = choice ? ownConstruction(choice, reg) : undefined;
      const name = c ? (calledName(c) ?? "") : "";
      const source = reg.endpoint!.clients[name];
      const endpoint = c && source && source.config === undefined && !source.component ? fromRpcClient(name, argsOf(c), reg) : null;
      if (!endpoint) return null;
      endpoints.push(endpoint);
    }
  }
  return agreedEndpoint(endpoints, false);
}

/** `isTest ? testConfig : appConfig`, also through a variable: each config the app may hand its provider (#98). */
function choices(e: Expression, depth = 0): Expression[] {
  const u = unwrap(e);
  const value = Node.isIdentifier(u) && depth < MAX_DEPTH ? valueOf(u) : undefined;
  const inner = value ? unwrap(value) : u;
  if (!Node.isConditionalExpression(inner) || depth >= MAX_DEPTH) return [e];
  return [...choices(inner.getWhenTrue(), depth + 1), ...choices(inner.getWhenFalse(), depth + 1)];
}

/**
 * The config a config is built from (#98): ConnectKit's `createConfig(getDefaultConfig({ transports }))`, also spread
 * into the options (`createConfig({ ...kitConfig, ssr: true })`), when its package's own.
 */
export function innerConfig(arg: Expression | undefined, reg: RegistryEntry): Construction | undefined {
  const direct = arg ? ownConstruction(arg, reg) : undefined;
  if (direct || !arg) return direct ?? undefined;
  const spreads = toObjectLiteral(arg)?.getProperties().filter((p) => Node.isSpreadAssignment(p)) ?? [];
  for (const s of spreads.reverse()) {
    const c = Node.isSpreadAssignment(s) ? ownConstruction(s.getExpression(), reg) : undefined;
    if (c) return c;
  }
  return undefined;
}

/**
 * The client construction an expression holds, when the registry's package builds it: a `getDefaultConfig` of another
 * library is no wagmi config (null: a client the scan does not read).
 */
export function ownConstruction(e: Expression, reg: RegistryEntry): Construction | null | undefined {
  const c = constructionOf(e, reg);
  if (!c) return undefined;
  const pkg = describeCallee(c).package;
  return (reg.endpoint?.clientPackage ? pkg === reg.endpoint.clientPackage : ofEntry(pkg, reg)) ? c : null;
}

/** The client of a config (`usePublicClient({ config })`, `getPublicClient(config)`): the config given, else the project's one. */
export function configEndpoint(node: Construction, source: ClientSource, args: Expression[], reg: RegistryEntry): Endpoint | null {
  const given = at(args, source.config);
  const c = given ? ownConstruction(given, reg) : undefined;
  if (c === null) return null;
  const root = c && !reg.endpoint!.clients[calledName(c) ?? ""]?.config ? c : undefined;
  return root ? fromRpcClient(calledName(root) ?? "", argsOf(root), reg) : cachedProjectEndpoint(node.getProject(), reg);
}
