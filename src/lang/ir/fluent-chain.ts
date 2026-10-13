import { appliedSteps, expandApplied } from "./applied.js";
import { callsOn, type ScopedCall } from "./fluent.js";
import { injectedCall, injectedField, paramValue } from "./injected.js";
import type { Scoped } from "./language.js";
import type { CallExpr, ClassDef, Expr, FunctionDef } from "./model.js";
import { classField, classMethod, lookup, receiverClass, type Binding } from "./project.js";
import type { IrCtx, Subst } from "./raw.js";
import { overloadFor } from "./overloads.js";
import { substitutionFor } from "./wrappers.js";

const MAX_DEPTH = 8;
/** Calls read on one builder: far more than any request needs, and a bound for generated code. */
const MAX_STEPS = 400;
/**
 * Chains a value is followed into when it branches (the returns of a factory, the branches of an `if` / `when`): more
 * are not listed, the value is read as one unknown instead.
 */
export const MAX_ALTERNATIVES = 4;

export interface FluentChain {
  /** The call the chain starts from (`Request.Builder()`), when one of the start names was found. */
  start?: ScopedCall;
  /** The calls after it, in order, those made on a variable holding the builder included. */
  steps: ScopedCall[];
  /** The parameters of the factories the chain went through, bound to the arguments of their calls. */
  subst?: Subst;
  /** Without a start: the value the chain was last followed to (a parameter, an unknown call). */
  end?: Scoped;
  /**
   * The branches of conditionals the chain went through (`fluentChains`): chains that differ only by the return of a
   * factory they went through have the same one.
   */
  branch?: string;
  /** After a conditional: how many of the last steps are made after it, on whichever branch's value. */
  shared?: number;
}

const classBinding = (b: Binding): ClassDef | undefined => (b.kind === "class" ? b.cls : undefined);
const functionBinding = (b: Binding): FunctionDef | undefined => (b.kind === "function" ? b.fn : undefined);

/**
 * A function calling its own name delegates to an overload (`fun get(url: String) = get(url.toHttpUrl())`), which the
 * name does not resolve to: the other function of that name in the same scope.
 */
function overload(target: FunctionDef, from: FunctionDef): FunctionDef {
  if (target !== from) return target;
  return target.module.allFunctions.find((f) => f !== target && f.name === target.name && f.cls === target.cls && f.parent === target.parent) ?? target;
}

/** A method of the class the code runs in (`this.buildRequest(url)`, a bare call in Java and Kotlin) or of a named class (`Requests.get(url)`). */
function factoryMethod(callee: Expr, fn: FunctionDef, ctx: IrCtx): FunctionDef | undefined {
  if (callee.k !== "attr") return undefined;
  const owner = callee.obj.k === "this" ? receiverClass(fn, ctx.self, ctx.idx) : callee.obj.k === "name" ? classBinding(lookup(callee.obj.name, fn, callee.pos.offset, ctx.idx)) : undefined;
  return owner ? classMethod(owner, callee.name, ctx.idx) : undefined;
}

/** The project function a call runs, when it may be a factory (`fun client() = ...`, `by lazy { ... }`, `this.request(url)`). */
function factoryOf(call: CallExpr, fn: FunctionDef, ctx: IrCtx): FunctionDef | undefined {
  const named = call.fn.k === "fnref" ? call.fn.fn : call.fn.k === "name" ? functionBinding(lookup(call.fn.name, fn, call.pos.offset, ctx.idx)) : factoryMethod(call.fn, fn, ctx);
  const target = named && call.fn.k !== "fnref" ? overloadFor(named, call, fn, ctx) : named;
  return target ? overload(target, fn) : undefined;
}

/**
 * What a factory of the project returns, every `return` of it; its parameters stand for the call's arguments (`fun
 * get(url: String) = Request.Builder().url(url)`). A factory with several returns is only followed into when the walk
 * branches (`fluentChains`): `max` is how many returns it may have.
 */
function factoryReturns(call: CallExpr, fn: FunctionDef, ctx: IrCtx, w: Walk, max: number): Scoped[] | undefined {
  const target = factoryOf(call, fn, ctx);
  if (!target || target.returns.length === 0 || target.returns.length > max) return undefined;
  for (const [p, v] of substitutionFor(target, call, fn)) w.subst.set(p, v);
  return target.returns.map((r) => ({ expr: r, fn: target }));
}

const RETURNED = new WeakMap<FunctionDef, Set<CallExpr>>();

/**
 * Calls a function returns (`return target.path(version);`): made on a variable, they build the value returned there,
 * not the variable's value read after them (`return target;`).
 */
function returnedCalls(fn: FunctionDef): Set<CallExpr> {
  let out = RETURNED.get(fn);
  if (!out) {
    out = new Set<CallExpr>();
    for (let e of fn.returns) {
      for (; e.k === "call" && e.fn.k === "attr"; e = e.fn.obj) out.add(e);
    }
    RETURNED.set(fn, out);
  }
  return out;
}

/** The state of one walk down a chain: the steps found so far, the factory parameters bound, the hops made. */
interface Walk {
  steps: ScopedCall[];
  subst: Subst;
  hops: number;
  /** The conditional branches taken so far (`0.1.`). */
  branch: string;
  /** How many steps were found before the first conditional: those made after it in the code. */
  sharedFrom?: number;
}

/** The next value down a chain: a variable's value (and the calls made on it), a parameter's argument, a field. */
function below(e: Expr, fn: FunctionDef, ctx: IrCtx, w: Walk): Scoped | undefined {
  if (e.k === "scoped") return { expr: e.expr, fn: e.fn };
  if (e.k === "attr") {
    // `this.client`, `ApiClient.client` (an `object` or companion member)
    const owner = e.obj.k === "this" ? receiverClass(fn, ctx.self, ctx.idx) : e.obj.k === "name" ? classBinding(lookup(e.obj.name, fn, e.pos.offset, ctx.idx)) : undefined;
    const values = owner ? classField(owner, e.name, ctx.idx) : [];
    if (values.length === 0 && e.obj.k === "this") return injectedField(owner, e.name, ctx);
    return values.length === 1 ? { expr: values[0]!.value, fn: values[0]!.fn } : undefined;
  }
  if (e.k === "call") return factoryReturns(e, fn, ctx, w, 1)?.[0] ?? injectedCall(e, fn, ctx);
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "param") return w.subst.get(b.param) ?? paramValue(b.param, b.fn, ctx);
  if (b.kind !== "value" || b.assign.augmented) return undefined;
  const returned = returnedCalls(b.fn);
  w.steps.unshift(...callsOn(b.fn, e.name, b.assign.offset).filter((c) => (b.fn !== fn || c.call.pos.offset < e.pos.offset) && !returned.has(c.call)));
  return { expr: b.assign.value, fn: b.fn };
}

/** `if` / `when` / `?:` / `switch` values: each branch, the first one first. */
function branchesOf(e: Expr & { k: "cond" }): Expr[] {
  return [e.then, ...(e.else.k === "cond" ? branchesOf(e.else) : [e.else])];
}

/** Where a branching walk splits: the branches of a conditional, the returns of a factory with several. */
function forksAt(cur: Scoped, ctx: IrCtx, w: Walk): { values: Scoped[]; conditional: boolean } | undefined {
  if (cur.expr.k === "cond") return { values: branchesOf(cur.expr).map((expr) => ({ expr, fn: cur.fn })), conditional: true };
  if (cur.expr.k !== "call") return undefined;
  const target = factoryOf(cur.expr, cur.fn, ctx);
  const values = target && target.returns.length > 1 ? factoryReturns(cur.expr, cur.fn, ctx, w, MAX_ALTERNATIVES + 1) : undefined;
  return values ? { values, conditional: false } : undefined;
}

/** The walk down one branch of a fork: a conditional's branches are told apart, a factory's returns are not. */
function forked(w: Walk, i: number, conditional: boolean): Walk {
  const branch = conditional ? `${w.branch}${i}.` : w.branch;
  return { steps: [...w.steps], subst: new Map(w.subst), hops: w.hops + 1, branch, sharedFrom: conditional ? (w.sharedFrom ?? w.steps.length) : w.sharedFrom };
}

function finish(w: Walk, start: ScopedCall | undefined, end: Scoped): FluentChain {
  const shared = w.sharedFrom === undefined ? undefined : expandApplied(w.steps.slice(w.steps.length - w.sharedFrom)).length;
  return {
    ...(start ? { start } : { end }),
    steps: expandApplied(start ? [...appliedSteps(start.call.applied), ...w.steps] : w.steps),
    ...(w.subst.size > 0 ? { subst: w.subst } : {}),
    ...(w.branch ? { branch: w.branch } : {}),
    ...(shared !== undefined ? { shared } : {}),
  };
}

function walk(from: Scoped, w: Walk, isStart: (c: CallExpr) => boolean, ctx: IrCtx, out: FluentChain[], branching: boolean): void {
  let cur: Scoped | undefined = from;
  let end: Scoped = from;
  // calls down the expression are bounded by its size; hops through variables, fields and factories are counted
  while (cur && w.hops < MAX_DEPTH && w.steps.length < MAX_STEPS) {
    const { expr, fn }: Scoped = (end = cur);
    if (expr.k === "call" && isStart(expr)) {
      out.push(finish(w, { call: expr, fn }, end));
      return;
    }
    const forks = branching ? forksAt(cur, ctx, w) : undefined;
    if (forks) {
      forks.values.forEach((f, i) => {
        if (out.length <= MAX_ALTERNATIVES) walk(f, forked(w, i, forks.conditional), isStart, ctx, out, branching);
      });
      return;
    }
    // `this.buildRequest(url)`, `Requests.get(url)`: a method of the project returning the builder, not a step of it
    const made: Scoped | undefined = expr.k === "call" && factoryMethod(expr.fn, fn, ctx) ? factoryReturns(expr, fn, ctx, w, 1)?.[0] : undefined;
    if (made) {
      cur = made;
      w.hops++;
      continue;
    }
    if (expr.k === "call" && expr.fn.k === "attr") {
      w.steps.unshift({ call: expr, fn });
      cur = { expr: expr.fn.obj, fn };
      continue;
    }
    cur = below(expr, fn, ctx, w);
    w.hops++;
  }
  out.push(finish(w, undefined, end));
}

/**
 * The calls a fluent value is built with: `Request.Builder().url(u).post(b).build()` is the start `Builder()` and the
 * steps `url`, `post`, `build`, also through variables (`val b = Request.Builder(); b.header(...)`) and fields.
 * Steps inside Kotlin `apply { ... }` and `also { ... }` are steps too. A factory with several returns ends the chain.
 */
export function fluentChain(s: Scoped, isStart: (c: CallExpr) => boolean, ctx: IrCtx): FluentChain {
  const out: FluentChain[] = [];
  walk(s, { steps: [], subst: new Map(), hops: 0, branch: "" }, isStart, ctx, out, false);
  return out[0]!;
}

/**
 * Every chain a value may be built with: one per return of a factory with several (`if (v != null) return
 * target.path(v); return target;`) and per branch of a conditional (`when (verb) { GET -> c.prepareGet(u) ... }`),
 * in source order. The walk stops after `MAX_ALTERNATIVES + 1`: more than `MAX_ALTERNATIVES` are not one of a few.
 */
export function fluentChains(s: Scoped, isStart: (c: CallExpr) => boolean, ctx: IrCtx): FluentChain[] {
  const out: FluentChain[] = [];
  walk(s, { steps: [], subst: new Map(), hops: 0, branch: "" }, isStart, ctx, out, true);
  return out;
}
