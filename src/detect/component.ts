import { Node, SyntaxKind, type Expression } from "ts-morph";
import { identifierOrigin } from "../ast/origin.js";
import type { JsxOpeningLikeElement, RawCall } from "../types.js";
import { clientEndpoint } from "./endpoint.js";
import type { Registry } from "./registry/index.js";

/** The value a JSX attribute is given: `query={graphql`...`}`, `name="x"`; undefined for a bare or spread attribute. */
function propValue(el: JsxOpeningLikeElement, name: string): Expression | undefined {
  const attr = el.getAttributes().find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
  const init = attr && Node.isJsxAttribute(attr) ? attr.getInitializer() : undefined;
  if (init && Node.isJsxExpression(init)) return init.getExpression();
  return init && Node.isStringLiteral(init) ? init : undefined;
}

/**
 * A JSX element of a package's component that sends a request as it renders (`components` of a registry, Relay's
 * `<QueryRenderer environment={env} query={graphql`...`} variables={{ id }} />`, #83): its props, in the order the
 * registry lists them, are the method's arguments.
 */
function componentCall(el: JsxOpeningLikeElement, registry: Registry): RawCall | null {
  const tag = el.getTagNameNode();
  const origin = Node.isIdentifier(tag) ? identifierOrigin(tag) : undefined;
  if (origin?.kind !== "package") return null;
  const reg = registry.byPackage(origin.package);
  const name = origin.importedName;
  const spec = reg?.components && Object.hasOwn(reg.components, name) ? reg.components[name] : undefined;
  if (!reg || !spec) return null;
  const args = (spec.props ?? []).map((p) => propValue(el, p)) as Expression[];
  const raw: RawCall = {
    node: el,
    client: "sdk",
    sdk: { package: origin.package, provider: reg.provider, host: spec.host ?? reg.host, chain: name, spec, auth: spec.auth ?? reg.auth, args, inlinePath: reg.inlinePathLiterals, basePath: reg.basePath, anyHost: !!reg.endpoint },
    bodyKey: "input",
  };
  if (spec.bodyArg !== undefined && args[spec.bodyArg]) raw.bodyExpr = args[spec.bodyArg];
  const endpoint = reg.endpoint ? clientEndpoint(el, reg, spec, { chain: [] }, args) : {};
  if (endpoint.url) raw.baseUrlExpr = endpoint.url;
  if (endpoint.headers) raw.instanceHeadersExpr = endpoint.headers;
  return raw;
}

/** Requests sent by the JSX components of the registries, under `root`. */
export function detectComponents(root: Node, registry: Registry): RawCall[] {
  if (!registry.entries().some((e) => e.components)) return [];
  const elements = [...root.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...root.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)];
  return elements.flatMap((el) => componentCall(el, registry) ?? []);
}
