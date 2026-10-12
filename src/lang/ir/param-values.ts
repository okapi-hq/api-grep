import type { Part } from "../../types.js";
import { calleeChain } from "./chain.js";
import { evaluate } from "./evaluate.js";
import type { Scoped } from "./language.js";
import { argFor, type CallExpr, type Expr, type FunctionDef, type Param } from "./model.js";
import { lookup, type ProjectIndex } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * The values a parameter takes when no wrapper expansion substituted it (#39): the arguments its callers in the project
 * pass, one level up, and its default when some caller leaves it out or nobody calls the function.
 */

/** Callers read per function: past that, a helper called from everywhere, whose values say little. */
const MAX_CALLERS = 20;

interface CallSite {
  call: CallExpr;
  fn: FunctionDef;
}

const callsByName = new WeakMap<ProjectIndex, Map<string, CallSite[]>>();
const callersCache = new WeakMap<FunctionDef, CallSite[]>();

const calleeName = (call: CallExpr): string | undefined =>
  call.fn.k === "name" ? call.fn.name : call.fn.k === "attr" ? call.fn.name : call.fn.k === "qname" ? call.fn.path[call.fn.path.length - 1] : undefined;

/** Every call of the project by the name it calls, built once: callers are then resolved among same-named calls only. */
function namedCalls(idx: ProjectIndex): Map<string, CallSite[]> {
  let byName = callsByName.get(idx);
  if (byName) return byName;
  byName = new Map();
  for (const mod of idx.all()) {
    for (const fn of mod.allFunctions) {
      for (const call of fn.calls) {
        const name = calleeName(call);
        if (name) byName.set(name, [...(byName.get(name) ?? []), { call, fn }]);
      }
    }
  }
  callsByName.set(idx, byName);
  return byName;
}

const CONSTRUCTORS = new Set(["__init__", "__construct"]);

/** Whether `site` runs `target`: a call of the function or method, or of the class whose constructor it is. */
function runs(site: CallSite, target: FunctionDef, idx: ProjectIndex): boolean {
  const chain = calleeChain(site.call, site.fn, { idx });
  if (chain.segs.length > 0) return false;
  if (chain.root.kind === "function") return chain.root.fn === target;
  return CONSTRUCTORS.has(target.name) && (chain.root.kind === "class" || chain.root.kind === "instance") && chain.root.cls === target.cls;
}

function callersOf(target: FunctionDef, idx: ProjectIndex): CallSite[] {
  let found = callersCache.get(target);
  if (found) return found;
  const name = CONSTRUCTORS.has(target.name) && target.cls ? target.cls.name : target.name;
  // a recursive call is not a caller: its arguments are the function's own values
  found = (namedCalls(idx).get(name) ?? []).filter((s) => s.fn !== target && runs(s, target, idx));
  callersCache.set(target, found);
  return found;
}

export interface ParamSources {
  /** Callers' arguments and the default, each in its own scope. */
  sources: Scoped[];
  /** Some caller passes a value that cannot be told (a spread, more callers than are read). */
  unread: boolean;
}

/**
 * Undefined when nothing is known: no caller passes it and it has no default, or a caller's own parameter (one level).
 * `None` / `null` (a default or an argument) is left out: it stands for "not given" (`if user: kwargs["user"] = user`).
 */
export function paramSources(p: Param, fn: FunctionDef, ctx: IrCtx): ParamSources | undefined {
  if (ctx.callerLevel || p.kind !== "normal") return undefined;
  const callers = callersOf(fn, ctx.idx);
  const sources: Scoped[] = [];
  let unread = callers.length > MAX_CALLERS;
  let omitted = callers.length === 0;
  for (const site of callers.slice(0, MAX_CALLERS)) {
    const arg = argFor(site.call, p);
    if (arg) sources.push({ expr: arg.value, fn: site.fn });
    else if (site.call.args.some((a) => a.spread)) unread = true;
    else omitted = true;
  }
  if (omitted && p.default) sources.unshift({ expr: p.default, fn });
  const given = sources.filter((s) => s.expr.k !== "null");
  return given.length > 0 || unread ? { sources: given, unread } : undefined;
}

/** The context a caller's argument is read in: none of its own substitutions, and its parameters stay parameters. */
export function callerCtx(ctx: IrCtx): IrCtx {
  return { idx: ctx.idx, ...(ctx.envHints ? { envHints: ctx.envHints } : {}), callerLevel: true };
}

/**
 * A string value (a header) that is a parameter: what each source evaluates to, `undefined` for a value that cannot be
 * read.
 */
export function paramAlternatives(e: Expr, fn: FunctionDef, ctx: IrCtx): (Part[] | undefined)[] | undefined {
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind !== "param" || ctx.subst?.has(b.param)) return undefined;
  const found = paramSources(b.param, b.fn, ctx);
  if (!found) return undefined;
  const values = found.sources.map((s) => evaluate(s.expr, s.fn, callerCtx(ctx)));
  return found.unread ? [...values, undefined] : values;
}
