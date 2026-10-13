import { scopedIn, type ScopedCall } from "./fluent.js";
import type { OptionRole, Scoped } from "./language.js";
import { dottedPath, type CallExpr, type Expr, type FunctionDef } from "./model.js";
import { lambdaCalls, lambdaOf } from "./applied.js";
import type { IrPair } from "./raw.js";

export { lambdaCalls, lambdaOf };
export { fluentChain, fluentChains, type FluentChain } from "./fluent-chain.js";

/**
 * What one call of a fluent request or URL builder sets from its arguments (`.url(u)`, `.header(k, v)`,
 * `.post(body)`, `.addQueryParameter(k, v)`). Numbers are argument positions; `"receiver"` is the object the call
 * is made on (`base.newBuilder()`).
 */
export interface BuilderStep {
  method?: string;
  methodArg?: number;
  url?: number | "receiver";
  baseUrl?: number;
  /** A path segment (or several, `"rest"`: every argument from the first) appended to the URL. */
  path?: number | "rest";
  scheme?: number;
  host?: number;
  body?: number;
  bodyRole?: OptionRole;
  header?: [number, number];
  /** A header map or headers object. */
  headers?: number;
  query?: [number, number];
  /** A query map. */
  queryMap?: number;
  /** The Authorization header from a token (`bearerAuth(token)`) or credentials (`basicAuth(user, password)`). */
  bearer?: number;
  basic?: boolean;
  /** The body's content type. */
  contentType?: number;
  /** Arguments alternate header names and values (`headers("A", "1", "B", "2")`). */
  headerList?: boolean;
  /** The last argument is a lambda whose calls are steps of this nested table (Ktor `headers { append(k, v) }`). */
  lambda?: string;
}

/** Step tables by name: `request` and the nested ones a `lambda` step names. */
export type StepTables = Record<string, Record<string, BuilderStep>>;

/** What a chain of builder calls says about a request. */
export interface RequestParts {
  url?: Scoped;
  baseUrl?: Scoped;
  path: Scoped[];
  scheme?: Scoped;
  host?: Scoped;
  method?: Scoped;
  impliedMethod?: string;
  body?: Scoped;
  bodyRole?: OptionRole;
  contentType?: Scoped;
  headers: Scoped[];
  query?: Scoped;
  pairs: IrPair[];
}

export const emptyParts = (): RequestParts => ({ path: [], headers: [], pairs: [] });

/** The one of `names` a call's callee ends with (`Request.Builder`, `newBuilder`), if any. */
export function calleeIs(call: CallExpr, names: string[]): string | undefined {
  const last = call.fn.k === "attr" || call.fn.k === "name" ? call.fn.name : call.fn.k === "qname" ? call.fn.path[call.fn.path.length - 1] : undefined;
  const path = dottedPath(call.fn)?.join(".");
  return names.find((n) => (n.includes(".") ? !!path && (path === n || path.endsWith(`.${n}`)) : n === last));
}

/** Positional arguments; a trailing lambda is not a value a step reads (`post { ... }`, `url { ... }`). */
const positional = (c: ScopedCall): Expr[] => c.call.args.filter((a) => !a.name && !a.spread && a.value.k !== "fnref").map((a) => a.value);

export function argAt(c: ScopedCall, i: number | undefined): Scoped | undefined {
  const a = i !== undefined ? positional(c)[i] : undefined;
  return a ? { expr: a, fn: c.fn } : undefined;
}

/** A synthetic `Authorization` header pair: `Bearer <token>`, `Basic <credentials>`. */
function authPair(scheme: "bearer" | "basic", token: Scoped | undefined, into: FunctionDef): IrPair {
  const parts: Expr[] = [{ k: "str", v: scheme === "bearer" ? "Bearer " : "Basic " }, ...(token ? [scopedIn(token.expr, token.fn, into)] : [{ k: "unknown", text: "credentials" } as Expr])];
  return { where: "header", name: { expr: { k: "str", v: "Authorization" }, fn: into }, value: { expr: { k: "tmpl", parts }, fn: into } };
}

/** Applies one step: later steps win for the URL, method and body; headers and query parameters add up. */
export function applyStep(p: RequestParts, step: BuilderStep, c: ScopedCall): void {
  const at = (i: number | undefined): Scoped | undefined => argAt(c, i);
  const receiver = c.call.fn.k === "attr" ? { expr: c.call.fn.obj, fn: c.fn } : undefined;
  const url = step.url === "receiver" ? receiver : at(step.url);
  if (url) p.url = url;
  p.baseUrl = at(step.baseUrl) ?? p.baseUrl;
  if (step.path === "rest") p.path.push(...positional(c).map((e) => ({ expr: e, fn: c.fn })));
  else if (at(step.path)) p.path.push(at(step.path)!);
  p.scheme = at(step.scheme) ?? p.scheme;
  p.host = at(step.host) ?? p.host;
  if (step.method || step.methodArg !== undefined) {
    p.impliedMethod = step.method;
    p.method = at(step.methodArg);
  }
  const body = at(step.body);
  if (body) [p.body, p.bodyRole] = [body, step.bodyRole];
  if (step.header && at(step.header[0])) p.pairs.push({ where: "header", name: at(step.header[0])!, value: at(step.header[1]) });
  if (step.query && at(step.query[0])) p.pairs.push({ where: "query", name: at(step.query[0])!, value: at(step.query[1]) });
  if (at(step.headers)) p.headers.push(at(step.headers)!);
  p.query = at(step.queryMap) ?? p.query;
  if (step.bearer !== undefined) p.pairs.push(authPair("bearer", at(step.bearer), c.fn));
  if (step.basic) p.pairs.push(authPair("basic", undefined, c.fn));
  p.contentType = at(step.contentType) ?? p.contentType;
  if (step.headerList) {
    const args = positional(c);
    for (let i = 0; i + 1 < args.length; i += 2) p.pairs.push({ where: "header", name: { expr: args[i]!, fn: c.fn }, value: { expr: args[i + 1]!, fn: c.fn } });
  }
}

/** `parameters.append` before `append`: a call on a named object can have a step of its own. */
function stepOf(call: CallExpr, table: Record<string, BuilderStep>): BuilderStep | undefined {
  const f = call.fn;
  const keys = f.k === "attr" ? [...(f.obj.k === "name" ? [`${f.obj.name}.${f.name}`] : []), f.name] : f.k === "name" ? [f.name] : [];
  const key = keys.find((k) => Object.hasOwn(table, k));
  return key !== undefined ? table[key] : undefined;
}

/** Reads the steps a table knows; other calls (`build()`, timeouts, `version(...)`) set nothing. */
export function readSteps(calls: ScopedCall[], table: Record<string, BuilderStep>, parts = emptyParts(), nested: StepTables = {}, depth = 0): RequestParts {
  for (const c of calls) {
    const step = stepOf(c.call, table);
    if (!step) continue;
    applyStep(parts, step, c);
    const inner = step.lambda !== undefined ? lambdaOf(c.call) : undefined;
    const sub = step.lambda !== undefined ? nested[step.lambda] : undefined;
    if (inner && sub && depth < 3) readSteps(lambdaCalls(inner), sub, parts, nested, depth + 1);
  }
  return parts;
}

/** The URL the parts describe: the URL (or `scheme://host`) and the path segments appended to it, one `/` apart. */
export function composeUrl(p: RequestParts): Scoped | undefined {
  const head = p.url;
  const into = (head ?? p.host ?? p.path[0])?.fn;
  if (!into) return undefined;
  const parts: Expr[] = [];
  if (head) parts.push(scopedIn(head.expr, head.fn, into));
  else if (p.host) parts.push(p.scheme ? scopedIn(p.scheme.expr, p.scheme.fn, into) : { k: "str", v: "https" }, { k: "str", v: "://" }, scopedIn(p.host.expr, p.host.fn, into));
  for (const seg of p.path) {
    // `path("/v1/search")` after `https://host`, `addPathSegment("v1")` after `https://host/`: one `/` between them
    const prev = parts[parts.length - 1];
    const slash = !(seg.expr.k === "str" && seg.expr.v.startsWith("/")) && !(prev?.k === "str" && prev.v.endsWith("/"));
    parts.push(...(slash ? [{ k: "str", v: "/" } as Expr] : []), scopedIn(seg.expr, seg.fn, into));
  }
  return parts.length === 1 && head ? head : { expr: { k: "tmpl", parts }, fn: into };
}
