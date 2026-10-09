import { detectCall, detectIn, type Candidate, type IrDetected, type IrUnfollowed } from "./detect.js";
import type { Scoped } from "./language.js";
import { children, type CallExpr, type Expr, type FunctionDef, type Param } from "./model.js";
import { lookup } from "./project.js";
import { withSubst, type IrCtx, type IrRaw, type Subst } from "./raw.js";

const MAX_INNER = 3;

function wrapperName(fn: FunctionDef): string {
  return fn.cls ? `${fn.cls.name}.${fn.name}` : fn.name;
}

/** Whether an expression reads one of `params`, following local variables one level. */
function referencesParam(e: Expr, fn: FunctionDef, params: Set<Param>, ctx: IrCtx, depth: number): boolean {
  if (e.k === "name") {
    const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
    if (b.kind === "param" && params.has(b.param)) return true;
    if (b.kind === "value" && depth < 1 && referencesParam(b.assign.value, b.fn, params, ctx, depth + 1)) return true;
  }
  return children(e).some((c) => referencesParam(c, fn, params, ctx, depth));
}

function paramsFlowInto(fn: FunctionDef, inputs: Scoped[], ctx: IrCtx): boolean {
  const params = new Set(fn.params);
  return inputs.some((s) => s.fn === fn && referencesParam(s.expr, s.fn, params, ctx, 0));
}

/** The wrapper's parameters mapped to the caller's arguments (by position or keyword), else to their defaults. */
export function substitutionFor(target: FunctionDef, call: CallExpr, caller: FunctionDef): Subst {
  const subst: Subst = new Map();
  const positional = call.args.filter((a) => !a.name && !a.spread);
  for (const p of target.params) {
    if (p.kind !== "normal") continue;
    const arg = call.args.find((a) => a.name === p.name) ?? positional[p.index];
    if (arg) subst.set(p, { expr: arg.value, fn: caller });
    else if (p.default) subst.set(p, { expr: p.default, fn: target });
  }
  return subst;
}

interface Expansion {
  raw: IrRaw;
  subst: Subst;
  via: string[];
}

class Expander {
  private readonly bodies = new Map<FunctionDef, IrDetected>();
  private readonly direct = new Map<FunctionDef, IrRaw[]>();
  private readonly nested = new Map<FunctionDef, Expansion[]>();

  constructor(private readonly ctx: IrCtx) {}

  private bodyOf(fn: FunctionDef): IrDetected {
    let found = this.bodies.get(fn);
    if (!found) {
      found = detectIn(fn, this.ctx);
      this.bodies.set(fn, found);
    }
    return found;
  }

  /** HTTP calls in the wrapper's body that its parameters flow into. */
  directCalls(fn: FunctionDef): IrRaw[] {
    let direct = this.direct.get(fn);
    if (!direct) {
      direct = this.bodyOf(fn)
        .calls.filter((c) => !c.via && paramsFlowInto(fn, c.inputs, this.ctx))
        .slice(0, MAX_INNER);
      this.direct.set(fn, direct);
    }
    return direct;
  }

  /** Wrappers that `fn` calls with its own parameters. */
  innerWrappers(fn: FunctionDef): Candidate[] {
    const params = new Set(fn.params);
    return this.bodyOf(fn).candidates.filter((c) => c.target !== fn && c.call.args.some((a) => referencesParam(a.value, fn, params, this.ctx, 0)));
  }

  /** Second hop: when `fn` has no HTTP call of its own, the calls of the wrappers it calls, substituted at that call. */
  nestedCalls(fn: FunctionDef): Expansion[] {
    let nested = this.nested.get(fn);
    if (!nested) {
      this.nested.set(fn, []);
      nested = this.innerWrappers(fn)
        .flatMap((c) => this.directCalls(c.target).map((raw) => ({ raw, subst: substitutionFor(c.target, c.call, fn), via: [wrapperName(c.target)] })))
        .slice(0, MAX_INNER);
      this.nested.set(fn, nested);
    }
    return nested;
  }

  expansionsOf(fn: FunctionDef): Expansion[] {
    const direct = this.directCalls(fn);
    if (direct.length > 0) return direct.map((raw) => ({ raw, subst: new Map(), via: [] }));
    return this.nestedCalls(fn);
  }

  /** A wrapper three or more hops away from its HTTP call, named so the call site can be listed as not followed. */
  deeperWrapper(fn: FunctionDef): string | undefined {
    const hit = this.innerWrappers(fn).find((c) => this.directCalls(c.target).length === 0 && this.nestedCalls(c.target).length > 0);
    return hit ? wrapperName(hit.target) : undefined;
  }
}

/**
 * Expands wrappers at their call sites, up to two hops: calls to project functions whose body makes an HTTP call (or
 * calls a wrapper that does) with their parameters. Deeper chains come back as `wrapper-depth`.
 */
export function expandWrappers(candidates: Candidate[], ctx: IrCtx): { calls: IrRaw[]; unfollowed: IrUnfollowed[] } {
  const ex = new Expander(ctx);
  const calls: IrRaw[] = [];
  const unfollowed: IrUnfollowed[] = [];
  for (const cand of candidates) {
    const expansions = ex.expansionsOf(cand.target);
    if (expansions.length === 0) {
      const via = ex.deeperWrapper(cand.target);
      if (via) unfollowed.push({ call: cand.call, fn: cand.fn, reason: "wrapper-depth", via });
      continue;
    }
    const outer = substitutionFor(cand.target, cand.call, cand.fn);
    for (const e of expansions) {
      const subst: Subst = new Map([...e.subst, ...outer]);
      const redetected = detectCall(e.raw.call, e.raw.fn, withSubst(ctx, subst)).raw ?? e.raw;
      calls.push({ ...redetected, call: cand.call, fn: cand.fn, via: `wrapper:${[wrapperName(cand.target), ...e.via].join(">")}`, subst });
    }
  }
  return { calls, unfollowed };
}
