import { calleeChain, valueChain } from "../../ir/chain.js";
import { dottedPath, type CallExpr, type Expr, type FunctionDef } from "../../ir/model.js";
import { lookup } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { pathRef } from "../paths.js";
import { createdClass } from "../http/retrofit-link.js";

/**
 * The type a DI binding is for, compared across files: the class it resolves to (`okhttp3.OkHttpClient`, a project
 * class's qualified name) when the scope's imports tell, else the type as written from its first class name
 * (`OkHttpClient`, `Retrofit.Builder`).
 */
export interface TypeKey {
  full?: string;
  simple: string;
}

export const sameType = (a: TypeKey, b: TypeKey): boolean => (a.full && b.full ? a.full === b.full : a.simple === b.simple);

const firstClass = (path: string[]): number => Math.max(0, path.findIndex((p) => /^[A-Z]/.test(p)));

/** A declared type's key; none for a generic type (`Set<Interceptor>`, `Lazy<OkHttpClient>`) or a function type. */
export function typeKey(type: Expr, fn: FunctionDef, ctx: IrCtx): TypeKey | undefined {
  const path = dottedPath(type);
  if (!path) return undefined;
  const simple = path.slice(firstClass(path)).join(".");
  const c = valueChain(type, fn, ctx);
  if (c.root.kind === "class" && c.segs.length === 0) return { full: c.root.cls.qname, simple };
  if (c.root.kind === "external" && c.segs.length > 0 && c.segs.every((s) => !s.call)) return { full: c.segs.map((s) => s.name).join("."), simple };
  return { simple };
}

/** `Lazy<OkHttpClient>`, `Set<Interceptor>`: the generic type's simple name and its first type argument. */
export function generic(type: Expr | undefined): { name: string; arg: Expr } | undefined {
  if (type?.k !== "index") return undefined;
  const path = dottedPath(type.obj);
  const arg = type.key.k === "list" ? type.key.items[0] : type.key;
  return path && arg && arg.k !== "unknown" ? { name: path[path.length - 1]!, arg } : undefined;
}

const MAX_DEPTH = 3;
const STARTS = new Set(["builder", "newBuilder", "create"]);

/** The calls of a chain from the outermost in (`a.b().build()`: `build`, `b`), and what they are made on. */
function unchain(e: Expr): { calls: CallExpr[]; base: Expr } {
  const calls: CallExpr[] = [];
  let cur = e;
  while (cur.k === "call" && cur.fn.k === "attr" && !/^[A-Z]/.test(cur.fn.name)) {
    calls.push(cur);
    cur = cur.fn.obj;
  }
  return { calls, base: cur };
}

/** `X.Builder` built (`build()`) is an `X`; `RestTemplateBuilder` built is a `RestTemplate`. */
function built(path: string[], build: boolean): string[] {
  const last = path[path.length - 1]!;
  if (!build || !last.endsWith("Builder")) return path;
  return last === "Builder" ? path.slice(0, -1) : [...path.slice(0, -1), last.slice(0, -"Builder".length)];
}

function keyOfPath(path: string[] | undefined, at: CallExpr | Expr, fn: FunctionDef, ctx: IrCtx): TypeKey | undefined {
  if (!path || path.length === 0) return undefined;
  const pos = "pos" in at && at.pos ? at.pos : fn.pos;
  return typeKey(pathRef(path, pos), fn, ctx);
}

/** The declared type of a name: a parameter's, a typed local's. */
function declaredType(e: Expr & { k: "name" }, fn: FunctionDef, ctx: IrCtx): { type?: Expr; value?: { expr: Expr; fn: FunctionDef } } {
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "param") return { type: b.param.type };
  if (b.kind === "value") return { type: b.assign.type, value: { expr: b.assign.value, fn: b.fn } };
  return {};
}

/**
 * The type a provider without a declared type gives (`fun okHttp() = OkHttpClient.Builder()...build()`, a Koin
 * `single { HttpClient(CIO) { ... } }`): the class a constructor or builder chain makes, a created Retrofit service, or
 * a name's declared type.
 */
export function providedType(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): TypeKey | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (e.k === "call") {
    const created = createdClass(e, fn, ctx);
    if (created) return { full: created.qname, simple: created.name };
  }
  const { calls, base } = unchain(e);
  const build = calls.some((c) => c.fn.k === "attr" && c.fn.name === "build");
  const inner = calls[calls.length - 1];
  // `WebClient.builder()`, `HttpRequest.newBuilder()`, `WebClient.create(url)`: a static factory of the class
  if (inner?.fn.k === "attr" && STARTS.has(inner.fn.name)) {
    const owner = dottedPath(inner.fn.obj);
    if (owner && /^[A-Z]/.test(owner[owner.length - 1]!)) return keyOfPath(inner.fn.name === "create" || build ? owner : [...owner, "Builder"], inner, fn, ctx);
  }
  if (base.k === "call") {
    const path = dottedPath(base.fn);
    if (path && /^[A-Z]/.test(path[path.length - 1]!)) return keyOfPath(built(path, build), base, fn, ctx);
    // `single { createClient() }`: what the project function returns
    const target = calls.length === 0 ? calleeChain(base, fn, ctx) : undefined;
    if (target?.root.kind !== "function" || target.segs.length > 0) return undefined;
    const f = target.root.fn;
    return f.returnType ? typeKey(f.returnType, f, ctx) : f.returns[0] ? providedType(f.returns[0], f, ctx, depth + 1) : undefined;
  }
  if (base.k === "name") {
    const d = declaredType(base, fn, ctx);
    const path = d.type ? dottedPath(d.type) : undefined;
    if (path) return keyOfPath(built(path, build), d.type!, fn, ctx);
    if (d.value && calls.length === 0) return providedType(d.value.expr, d.value.fn, ctx, depth + 1);
    // `val builder = OkHttpClient.Builder()` filled in steps, then `builder.build()`: what the builder builds
    const pos = d.value?.expr.k === "call" ? d.value.expr.pos : undefined;
    if (d.value && build && pos) return providedType({ k: "call", fn: { k: "attr", obj: d.value.expr, name: "build", pos }, args: [], pos }, d.value.fn, ctx, depth + 1);
  }
  return undefined;
}
