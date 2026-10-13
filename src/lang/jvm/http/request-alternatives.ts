import { hasStaticHost, staticText } from "../../../resolve/parts.js";
import { evaluate } from "../../ir/evaluate.js";
import { MAX_ALTERNATIVES, type FluentChain } from "../../ir/fluent-chain.js";
import { callsOn, type ScopedCall } from "../../ir/fluent.js";
import type { CallExpr } from "../../ir/model.js";
import { withSubst, type IrCtx, type IrRaw } from "../../ir/raw.js";
import { calleeIs } from "../../ir/steps.js";

/**
 * A request started in several places (#73). Starts in the branches of a conditional (`when (verb) { "POST" ->
 * c.preparePost(u) ... }`) or assigned to a variable in branches (`case POST: b = c.preparePost(u)`) are one call each.
 * The returns of a factory (`if (v != null) return target.path(v); return target;`) are one call, as a helper with
 * several returns is in TypeScript and Python: the first with a literal host, else the first, its method unknown when
 * theirs differ.
 */

/** The starts of a client (`prepareGet`, `new HttpPost`), with the method each implies. */
export type Starts = Record<string, { method?: string }>;

/** One request the send call may send: a chain, whether it is one of several starts, and whether their methods differ. */
export type Alternative = FluentChain & { varies?: boolean; split?: boolean };

/**
 * The starts a request variable may hold where the start was found: also those assigned to it before, with nothing
 * called on it in between (`case POST: b = c.preparePost(u); break; default: b = c.prepareGet(u);`), in source order.
 */
function assignedStarts(starts: Starts, start: ScopedCall): ScopedCall[] {
  const mine = start.fn.assigns.find((a) => a.value === start.call);
  if (!mine) return [start];
  const names = Object.keys(starts);
  const out = [start];
  let next = mine.offset;
  const before = start.fn.assigns.filter((a) => a.target === mine.target && a.offset < mine.offset && !a.edit);
  for (const a of before.reverse()) {
    if (a.augmented || a.value.k !== "call" || calleeIs(a.value, names) === undefined) break;
    if (callsOn(start.fn, mine.target, a.offset).some((c) => c.call.pos.offset < next)) break;
    out.unshift({ call: a.value, fn: start.fn });
    next = a.offset;
  }
  return out;
}

/**
 * The calls a send may be: groups of chains, one call per group (a group holds the returns of a factory). Undefined
 * when there are more than `MAX_ALTERNATIVES`.
 */
export function alternatives(starts: Starts, chains: FluentChain[]): Alternative[][] | undefined {
  const groups = new Map<string, Alternative[]>();
  for (const fc of chains) {
    const assigned = fc.start ? assignedStarts(starts, fc.start) : [];
    // starts assigned in branches: every step found is made after them
    const each: Alternative[] = assigned.length > 1 ? assigned.map((start) => ({ ...fc, start, shared: fc.steps.length })) : [fc];
    each.forEach((a, i) => {
      const key = `${fc.branch ?? ""}|${each.length > 1 ? i : ""}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    });
  }
  const out = [...groups.values()];
  if (out.length > MAX_ALTERNATIVES) return undefined;
  return out.length > 1 ? out.map((g) => g.map((a) => ({ ...a, split: true }))) : out;
}

/** More starts than are listed, with different methods: the method of the first is not the request's. */
export function startsVary(starts: Starts, chains: FluentChain[]): boolean {
  const names = Object.keys(starts);
  const method = (c: CallExpr): string | undefined => starts[calleeIs(c, names)!]!.method;
  return new Set(chains.flatMap((fc) => (fc.start ? assignedStarts(starts, fc.start) : [])).map((s) => method(s.call))).size > 1;
}

function methodOf(raw: IrRaw, ctx: IrCtx): string | undefined {
  if (raw.impliedMethod) return raw.impliedMethod.toUpperCase();
  if (!raw.method) return "GET";
  return staticText(evaluate(raw.method.expr, raw.method.fn, withSubst(ctx, raw.subst)))?.toUpperCase();
}

/** The returns of a factory as one call: the first with a literal host, else the first; its method unknown when theirs differ. */
export function oneOf(raws: IrRaw[], ctx: IrCtx): IrRaw | undefined {
  if (raws.length <= 1) return raws[0];
  const host = (r: IrRaw): boolean => !!r.url && hasStaticHost(evaluate(r.url.expr, r.url.fn, withSubst(ctx, r.subst)));
  const pick = raws.find(host) ?? raws[0]!;
  const methods = new Set(raws.map((r) => methodOf(r, ctx)));
  if (methods.size === 1 && !methods.has(undefined)) return pick;
  return { ...pick, impliedMethod: undefined, method: { expr: { k: "unknown", text: "method" }, fn: pick.fn } };
}
