import type { Scoped } from "../ir/language.js";
import type { Assign, CallExpr, Expr, FunctionDef } from "../ir/model.js";
import { paramValue } from "../ir/injected.js";
import { callsOn } from "../ir/fluent.js";
import { lambdaOf } from "../ir/steps.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";

/**
 * The values a collection stands for, where one interceptor or filter is expected (#75): the items of a list (`listOf(a,
 * b)`, a multibinding the container injects), the element a `forEach` lambda receives, else the value itself.
 */

const MAX_DEPTH = 4;

/** A function and the lambdas written in it, at any depth (`chain.request().let { ... }`). */
export function withClosures(fn: FunctionDef): FunctionDef[] {
  const out = [fn];
  for (let i = 0; i < out.length && out.length < 32; i++) out.push(...fn.module.allFunctions.filter((f) => f.parent === out[i] && !out.includes(f)));
  return out;
}
/** Calls running a lambda per element, and the parameter the element is (`fold(init) { acc, x -> ... }`: the second). */
const EACH: Record<string, number> = { forEach: 0, onEach: 0, fold: 1 };

/** A loop variable (`for (Interceptor i : interceptors)`): the collection it goes over. */
function looped(e: Expr & { k: "name" }, fn: FunctionDef): Scoped | undefined {
  for (let f: FunctionDef | undefined = fn; f; f = f.parent) {
    // assigned in the loop, the variable is no longer the element
    if (f === fn && f.assigns.some((a) => a.target === e.name && a.offset < e.pos.offset)) return undefined;
    const loop = f.loops?.find((l) => l.name === e.name && l.from <= e.pos.offset && e.pos.offset < l.to);
    if (loop) return { expr: loop.over, fn: f };
    if (f.params.some((p) => p.name === e.name)) return undefined;
  }
  return undefined;
}

/**
 * `interceptors.forEach { addInterceptor(it) }`, `interceptors.fold(this) { b, i -> b.addInterceptor(i) }`, `for (i in
 * interceptors)`: the collection whose elements the name is.
 */
function iterated(e: Expr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (e.k !== "name") return undefined;
  const loop = looped(e, fn);
  if (loop) return loop;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "param" || !b.fn.parent) return undefined;
  const lambda = b.fn;
  const parent = b.fn.parent;
  const call = parent.calls.find((c) => c.fn.k === "attr" && Object.hasOwn(EACH, c.fn.name) && EACH[c.fn.name] === b.param.index && c.args.some((a) => a.value.k === "fnref" && a.value.fn === lambda));
  return call?.fn.k === "attr" ? { expr: call.fn.obj, fn: parent } : undefined;
}

/** Lists built empty or from items and filled with `add` (#100): `mutableListOf(a)`, `ArrayList<>()`, `buildList { }`. */
const GROWN = new Set(["mutableListOf", "arrayListOf", "ArrayList", "LinkedList", "mutableSetOf", "LinkedHashSet", "HashSet"]);
const ADDS = new Set(["add", "addAll"]);

/** The items an `add` / `addAll` call gives: its one argument, the elements of a collection for `addAll`. */
function added(c: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Scoped[] {
  const name = c.fn.k === "name" || c.fn.k === "attr" ? c.fn.name : "";
  const arg = c.args.length === 1 && !c.args[0]!.name ? c.args[0]!.value : undefined;
  if (!arg || !ADDS.has(name)) return [];
  return name === "addAll" ? elementsOf({ expr: arg, fn }, ctx, depth + 1) : [{ expr: arg, fn }];
}

/** `buildList { add(a); if (debug) add(b) }`: what the lambda adds, in a branch or not. */
function built(e: Expr, fn: FunctionDef, ctx: IrCtx, depth: number): Scoped[] | undefined {
  const lambda = e.k === "call" && e.fn.k === "name" && (e.fn.name === "buildList" || e.fn.name === "buildSet") ? lambdaOf(e) : undefined;
  if (!lambda) return undefined;
  return withClosures(lambda).flatMap((f) => f.calls.filter((c) => c.fn.k === "name").flatMap((c) => added(c, f, ctx, depth)));
}

/** `val list = mutableListOf<Interceptor>(); list.add(a)`: the items it is made with and those added to it after. */
function grown(s: Scoped, ctx: IrCtx, depth: number): Scoped[] | undefined {
  const set = listVariable(s, ctx);
  if (!set) return undefined;
  const v = set.assign.value;
  // Kotlin's `mutableListOf(a)` is lowered as a list; Java's `new ArrayList<>()` stays a call
  const initial = v.k === "list" ? v.items.map((expr) => ({ expr, fn: set.fn })) : [];
  const later = callsOn(set.fn, set.assign.target, set.assign.offset);
  return [...initial, ...later.flatMap((c) => added(c.call, c.fn, ctx, depth))];
}

/** The variable holding a list made to be filled, followed through variables, parameters and their arguments. */
function listVariable(s: Scoped, ctx: IrCtx): { assign: Assign; fn: FunctionDef } | undefined {
  let cur: Scoped | undefined = s;
  for (let i = 0; cur && i < MAX_DEPTH * 2; i++) {
    const e: Expr = cur.expr;
    if (e.k === "scoped") {
      cur = { expr: e.expr, fn: e.fn };
      continue;
    }
    if (e.k !== "name") return undefined;
    const b = lookup(e.name, cur.fn, e.pos.offset, ctx.idx);
    if (b.kind === "param") {
      cur = paramValue(b.param, b.fn, ctx);
      continue;
    }
    if (b.kind !== "value" || b.assign.augmented) return undefined;
    const v = b.assign.value;
    const callee = v.k === "call" && (v.fn.k === "name" || v.fn.k === "attr") ? v.fn.name : "";
    if (GROWN.has(callee) || v.k === "list") return { assign: b.assign, fn: b.fn };
    cur = { expr: v, fn: b.fn };
  }
  return undefined;
}

export function elementsOf(s: Scoped, ctx: IrCtx, depth = 0): Scoped[] {
  if (depth > MAX_DEPTH) return [s];
  const each = iterated(s.expr, s.fn, ctx);
  if (each) return elementsOf(each, ctx, depth + 1);
  // a variable filled after it is made: its items and the ones added, not the empty list it starts as
  const filled = grown(s, ctx, depth);
  if (filled) return filled.flatMap((i) => elementsOf(i, ctx, depth + 1));
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k === "list") return d.expr.items.flatMap((i) => elementsOf({ expr: i, fn: d.fn }, ctx, depth + 1));
  const items = built(d.expr, d.fn, ctx, depth);
  return items ? items.flatMap((i) => elementsOf(i, ctx, depth + 1)) : [s];
}
