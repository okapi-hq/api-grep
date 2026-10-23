import type { IrRegistryEntry, Scoped } from "../ir/language.js";
import { dottedPath, type CallExpr, type Entry, type Expr, type FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";
import segments from "./msgraph-segments.json" with { type: "json" };
import msgraphBetaSdk from "./registry/msgraph-beta-sdk.json" with { type: "json" };
import msgraphSdk from "./registry/msgraph-sdk.json" with { type: "json" };

/**
 * msgraph-sdk and msgraph-beta-sdk (Kiota request builders): the URL segment each attribute of a chain stands for
 * (`pathSegment`, rule `msgraph`), and the query a `RequestConfiguration` carries (`resolveCall`).
 */
export const MSGRAPH_REGISTRY = [msgraphSdk, msgraphBetaSdk] as unknown as IrRegistryEntry[];

const NAMES = segments.names as Record<string, string | null>;
const CONTEXT = segments.context as Record<string, Record<string, string | null>>;

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * The segment a request builder's attribute adds (`send_mail` -> `sendMail`, `count` -> `$count`, `graph_user` ->
 * `graph.user`), as the SDK's url templates write it; `by_*_id(x)` is x. `with_url(url)` replaces the whole URL, and the
 * builders' parameterized functions (`delta_with_token(token=...)`) put their arguments in the segment: neither is read.
 */
export function msgraphSegment(rule: string, name: string, call: boolean, before: string): string | number | null | undefined {
  if (rule !== "msgraph") return undefined;
  if (call) return /^by_\w+$/.test(name) ? 0 : name === "with_url" ? null : undefined;
  const byBefore = Object.hasOwn(CONTEXT, name) ? CONTEXT[name]! : undefined;
  if (byBefore) return (Object.hasOwn(byBefore, before) ? byBefore[before] : byBefore["*"]) ?? undefined;
  if (Object.hasOwn(NAMES, name)) return NAMES[name] ?? undefined;
  return name.startsWith("graph_") ? `graph.${camel(name.slice(6))}` : camel(name);
}

/** The OData system query options a query-parameters class sends with a `$`; any other name goes in camelCase. */
const ODATA = new Set(["count", "expand", "filter", "format", "orderby", "search", "select", "skip", "top"]);

const queryName = (kw: string): string => (ODATA.has(kw) ? `$${kw}` : kw === "id" ? "@id" : camel(kw));

/** The last name of a call of a class msgraph or Kiota exports (`RequestConfiguration`, `...GetQueryParameters`). */
function kiotaClass(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  const path = dottedPath(call.fn);
  const head = path ? lookup(path[0]!, fn, undefined, ctx.idx) : undefined;
  const root = head?.kind === "external" ? head.path[0] : undefined;
  return root === "msgraph" || root === "msgraph_beta" || root === "kiota_abstractions" ? path![path!.length - 1] : undefined;
}

/**
 * `RequestConfiguration(query_parameters=UsersRequestBuilder.UsersRequestBuilderGetQueryParameters(select=[...]))`
 * (also the builders' deprecated `...GetRequestConfiguration`): the query it sends, by the names the URL gives them.
 */
export function msgraphRequestConfiguration(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (!kiotaClass(call, fn, ctx)?.endsWith("RequestConfiguration")) return undefined;
  const given = call.args.find((a) => a.name === "query_parameters")?.value;
  const d = given ? deref(given, fn, ctx) : undefined;
  const params = d?.expr.k === "call" && kiotaClass(d.expr, d.fn, ctx)?.endsWith("QueryParameters") ? { call: d.expr, fn: d.fn } : undefined;
  if (given && !params) return undefined;
  const scoped = (value: Expr): Expr => (params && params.fn !== fn ? { k: "scoped", expr: value, fn: params.fn } : value);
  const entries = (params?.call.args ?? []).flatMap((a): Entry[] => (a.name ? [{ key: { k: "str", v: queryName(a.name) }, value: scoped(a.value) }] : []));
  return { expr: { k: "dict", entries }, fn };
}
