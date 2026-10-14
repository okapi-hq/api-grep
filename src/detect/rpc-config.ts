import { Node, SyntaxKind, type Expression, type JsxOpeningElement, type JsxSelfClosingElement, type Project } from "ts-morph";
import { getProp, toObjectLiteral } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import type { ClientSource, RegistryEntry } from "../types.js";
import { returnsOf } from "./client-cache.js";
import { argsOf, at, calledName, constructionOf, ofEntry, type Construction, type Endpoint } from "./endpoint.js";
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
  const found: Endpoint[] = [];
  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile() || sf.isFromExternalLibrary() || !sf.getFullText().includes(comp.name)) continue;
    for (const el of [...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      const tag = el.getTagNameNode();
      const origin = Node.isIdentifier(tag) && tag.getText() === comp.name ? identifierOrigin(tag) : undefined;
      if (origin?.kind === "package" && ofEntry(origin.package, reg)) found.push({ url: propValue(el, comp.url), headers: propValue(el, comp.headers) });
    }
  }
  const out = found.length === 1 ? found[0]! : {};
  known.set(`${reg.package}:${comp.name}`, out);
  return out;
}

/** The client of a config (`usePublicClient({ config })`, `getPublicClient(config)`): the config given, else the project's one. */
export function configEndpoint(node: Construction, source: ClientSource, args: Expression[], reg: RegistryEntry): Endpoint | null {
  const given = at(args, source.config);
  const c = given ? constructionOf(given, reg) : undefined;
  const root = c && !reg.endpoint!.clients[calledName(c) ?? ""]?.config ? c : undefined;
  return root ? fromRpcClient(calledName(root) ?? "", argsOf(root), reg) : cachedProjectEndpoint(node.getProject(), reg);
}
