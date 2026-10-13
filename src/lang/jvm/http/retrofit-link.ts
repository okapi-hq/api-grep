import { calleeChain, valueChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, ClassDef, FunctionDef, ModuleModel } from "../../ir/model.js";
import type { IrCtx } from "../../ir/raw.js";
import { argAt, calleeIs, fluentChain } from "../../ir/steps.js";
import { classField, receiverClass } from "../../ir/project.js";
import { deref } from "../../ir/values.js";
import { JVM } from "./tables.js";

const R = JVM.retrofit;

/** What a `Retrofit.Builder()` chain sets: base URL, OkHttp client, converter factories in order. */
export interface RetrofitBuild {
  baseUrl?: Scoped;
  client?: Scoped;
  converters: string[];
}

/** `retrofit.create(Api::class.java)`, `retrofit.create<Api>()`, `Feign.builder().target(Api::class.java, url)`: the project class. */
export function createdClass(call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth = 0): ClassDef | undefined {
  if (call.fn.k !== "attr" || calleeIs(call, [...R.creates, ...JVM.feign.targets]) === undefined) return undefined;
  // `fun api(retrofit: Retrofit): Api = retrofit.create()`, `val api: Api = retrofit.create()`: the declared type
  const declared = () => (fn.returns.includes(call) ? fn.returnType : fn.assigns.find((a) => a.value === call)?.type);
  const ref = call.typeArgs?.[0] ?? call.args.find((a) => !a.name && !a.spread)?.value ?? declared();
  if (!ref || ref.k === "call") return undefined;
  // the depth of the chain being resolved: `val api = retrofit.create(api)` must not recurse forever
  const c = valueChain(ref, fn, ctx, depth + 1);
  return c.root.kind === "class" && c.segs.length === 0 ? c.root.cls : undefined;
}

/** Through the project's factories: `ApiClient.getClient()` returns the Retrofit it builds (a singleton, a `by lazy`). */
function throughFactories(s: Scoped, ctx: IrCtx): Scoped {
  let cur = s;
  for (let i = 0; i < 4 && cur.expr.k === "call"; i++) {
    const c = calleeChain(cur.expr, cur.fn, ctx);
    if (c.root.kind !== "function" || c.segs.length > 0 || c.root.fn.returns.length !== 1) break;
    cur = { expr: c.root.fn.returns[0]!, fn: c.root.fn };
  }
  return cur;
}

/** A field set in several places (`private var retrofit: Retrofit? = null`, then set in its getter): each value set. */
function fieldValues(s: Scoped, ctx: IrCtx): Scoped[] {
  const e = s.expr;
  const cls = e.k === "attr" && e.obj.k === "this" ? receiverClass(s.fn, ctx.self, ctx.idx) : undefined;
  const values = cls && e.k === "attr" ? classField(cls, e.name, ctx.idx).filter((v) => v.value.k !== "null") : [];
  return values.length > 0 ? values.map((v) => ({ expr: v.value, fn: v.fn })) : [s];
}

/** The builder steps of a Retrofit value, or undefined when no `Retrofit.Builder()` is found. */
export function readBuild(retrofit: Scoped, ctx: IrCtx): RetrofitBuild | undefined {
  const isStart = (c: CallExpr): boolean => calleeIs(c, R.builders) !== undefined;
  const fc = fieldValues(throughFactories(retrofit, ctx), ctx)
    .map((v) => fluentChain(v, isStart, ctx))
    .find((c) => c.start);
  if (!fc) return undefined;
  const out: RetrofitBuild = { converters: [] };
  for (const step of fc.steps) {
    const arg = argAt(step, 0);
    if (!arg) continue;
    if (calleeIs(step.call, R.baseUrl)) out.baseUrl = arg;
    else if (calleeIs(step.call, R.client)) out.client = arg;
    else if (calleeIs(step.call, R.converter)) {
      const d = deref(arg.expr, arg.fn, ctx).expr;
      const kind = d.k === "call" ? calleeIs(d, Object.keys(R.converters)) : undefined;
      if (kind) out.converters.push(R.converters[kind]!);
    }
  }
  return out;
}

interface Links {
  byClass: Map<ClassDef, RetrofitBuild[]>;
  /** Every Retrofit the project builds. */
  all: RetrofitBuild[];
  /**
   * The Retrofit a receiver of unknown origin is: the project's only build, when it makes a single
   * `Retrofit.Builder()`. Another builder (a DI-provided `Retrofit.Builder` its users finish) leaves it unknown.
   */
  only?: RetrofitBuild;
}

const cache = new WeakMap<ModuleModel[], Links>();

const sameBuild = (a: RetrofitBuild, b: RetrofitBuild): boolean => a.baseUrl?.expr === b.baseUrl?.expr && a.client?.expr === b.client?.expr;

function add(list: RetrofitBuild[], b: RetrofitBuild): void {
  if (!list.some((x) => sameBuild(x, b))) list.push(b);
}

/** Every `build()` of a `Retrofit.Builder()` chain, and every `create(...)` linked to the builds it is made on. */
function index(ctx: IrCtx): Links {
  const mods = ctx.idx.all();
  const found = cache.get(mods);
  if (found) return found;
  const links: Links = { byClass: new Map(), all: [] };
  const creates: { call: CallExpr; fn: FunctionDef; cls: ClassDef }[] = [];
  let builders = 0;
  for (const fn of mods.flatMap((m) => m.allFunctions)) {
    for (const call of fn.calls) {
      if (calleeIs(call, R.builders) !== undefined) builders++;
      if (calleeIs(call, ["build"]) !== undefined && call.fn.k === "attr") {
        const b = readBuild({ expr: call, fn }, ctx);
        if (b) add(links.all, b);
      }
      const cls = calleeIs(call, R.creates) !== undefined ? createdClass(call, fn, ctx) : undefined;
      if (cls) creates.push({ call, fn, cls });
    }
  }
  if (builders === 1 && links.all.length === 1) links.only = links.all[0];
  for (const c of creates) {
    const receiver = c.call.fn.k === "attr" ? { expr: c.call.fn.obj, fn: c.fn } : undefined;
    const b = (receiver && readBuild(receiver, ctx)) ?? links.only;
    const list = links.byClass.get(c.cls) ?? [];
    if (b) add(list, b);
    links.byClass.set(c.cls, list);
  }
  cache.set(mods, links);
  return links;
}

/**
 * The Retrofit builds a service interface is created with (`linked`). An interface created on a Retrofit of unknown
 * origin (a DI parameter), or never created in the project, gets the project's only build when there is one.
 */
export function buildsFor(cls: ClassDef, ctx: IrCtx): { builds: RetrofitBuild[]; linked: boolean } {
  const links = index(ctx);
  const own = links.byClass.get(cls) ?? [];
  if (own.length > 0) return { builds: own, linked: true };
  return { builds: links.only ? [links.only] : [], linked: false };
}
