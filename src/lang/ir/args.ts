import type { Scoped } from "./language.js";
import type { Arg, CallExpr, Entry, Expr, FunctionDef } from "./model.js";
import type { IrCtx, Seg } from "./raw.js";
import { dictOf, entryOf } from "./values.js";

/** Positional argument N of a call, or the keyword argument `name`. */
export function argOf(seg: Seg | undefined, index: number | undefined, name?: string): Scoped | undefined {
  if (!seg?.call || !seg.fn) return undefined;
  const byName = name !== undefined ? seg.call.args.find((a) => a.name === name) : undefined;
  if (byName) return { expr: byName.value, fn: seg.fn };
  if (index === undefined) return undefined;
  const positional = seg.call.args.filter((a) => !a.name && !a.spread);
  const a = positional[index];
  return a ? { expr: a.value, fn: seg.fn } : undefined;
}

/**
 * `"0"`, `"kw:base_url"`, `"0.base_uri"`, `"kw:options.base_url"`: an argument, or a key of a dict argument;
 * `"0|kw:supabase_url"` tries each in turn.
 */
export function argAt(seg: Seg | undefined, where: string, ctx: IrCtx): Scoped | undefined {
  if (where.includes("|")) return where.split("|").reduce<Scoped | undefined>((hit, w) => hit ?? argAt(seg, w, ctx), undefined);
  const m = /^(?:kw:(\w+)|(\d+))(?:\.(\w+))?$/.exec(where);
  if (!m) return undefined;
  const arg = m[1] !== undefined ? argOf(seg, undefined, m[1]) : argOf(seg, Number(m[2]));
  if (!arg || m[3] === undefined) return arg;
  return propOf(arg, m[3], ctx);
}

/** A key of the dict an expression stands for. */
export function propOf(s: Scoped | undefined, key: string, ctx: IrCtx): Scoped | undefined {
  if (!s) return undefined;
  const dict = dictOf(s.expr, s.fn, ctx);
  return dict ? entryOf(dict, key, ctx) : undefined;
}

/** Keyword arguments of a call as one dict (`create(model=..., **extra)`), minus `skip`. */
export function kwargsDict(call: CallExpr, skip: Set<string>): Expr | undefined {
  const entries: Entry[] = [];
  for (const a of call.args) {
    if (a.spread === "dict") entries.push({ value: a.value, spread: true });
    else if (a.name && !skip.has(a.name)) entries.push({ key: { k: "str", v: a.name }, value: a.value });
  }
  return entries.length > 0 ? { k: "dict", entries } : undefined;
}

/** Options of an HTTP call: keyword arguments (Python), or the keys of an options array (PHP). */
export interface Options {
  get(key: string): Scoped | undefined;
  values(): Scoped[];
  /** Options were passed but could not be read (a variable of unknown content). */
  opaque: boolean;
}

export function kwargOptions(call: CallExpr, fn: FunctionDef, ctx: IrCtx, from = 0): Options {
  const named = new Map<string, Scoped>();
  const spreads: Arg[] = [];
  for (const a of call.args.slice(from)) {
    if (a.name) named.set(a.name, { expr: a.value, fn });
    else if (a.spread === "dict") spreads.push(a);
  }
  let opaque = false;
  for (const sp of spreads) {
    const dict = dictOf(sp.value, fn, ctx);
    if (!dict) opaque = true;
    for (const en of dict?.entries ?? []) if (en.key?.k === "str" && !named.has(en.key.v)) named.set(en.key.v, { expr: en.value, fn: dict!.fn });
  }
  return { get: (k) => named.get(k), values: () => [...named.values()], opaque };
}

export function arrayOptions(arg: Scoped | undefined, ctx: IrCtx): Options {
  if (!arg) return { get: () => undefined, values: () => [], opaque: false };
  const dict = dictOf(arg.expr, arg.fn, ctx);
  if (!dict) return { get: () => undefined, values: () => [], opaque: arg.expr.k !== "null" };
  return { get: (k) => entryOf(dict, k, ctx), values: () => dict.entries.map((e) => ({ expr: e.value, fn: dict.fn })), opaque: false };
}
