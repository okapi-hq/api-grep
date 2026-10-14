import { argOf } from "./args.js";
import { mayNotRun } from "./edits.js";
import type { Scoped } from "./language.js";
import type { Entry } from "./model.js";
import { lookup } from "./project.js";
import type { IrCtx, IrSdkMatch } from "./raw.js";
import { deref } from "./values.js";

/**
 * Records of an active-record SDK (ShopifyAPI, #92 / #102): `product = shopify.Product(attributes)` or
 * `product = shopify.Product.find(id)`, then `product.title = t` and `product.save()`. The record sends the attributes
 * it is built with and those the code sets on it, in the function that calls the method, before the call.
 */

/** The attributes set on the variable the method is called on, after it is bound and before the call. */
function attributeEntries(m: IrSdkMatch, ctx: IrCtx): Entry[] {
  const call = m.method.call;
  const fn = m.method.fn;
  const target = call?.fn.k === "attr" && call.fn.obj.k === "name" ? call.fn.obj.name : undefined;
  if (!call || !fn || !target || !fn.attrSets) return [];
  const at = call.pos.offset;
  const b = lookup(target, fn, at, ctx.idx);
  if (b.kind !== "value" || b.fn !== fn) return [];
  const from = b.assign.offset;
  return fn.attrSets
    .filter((s) => s.target === target && s.offset > from && s.offset < at)
    .map((s) => ({ key: { k: "str", v: s.name }, value: s.value, ...(mayNotRun(fn, s.offset, at) ? { optional: true } : {}) }));
}

/** Whether the record was read rather than built (`Product.find(id).save()`): it holds no attributes of the code's. */
const wasRead = (m: IrSdkMatch): boolean => !!m.entry.recordFrom?.includes(m.segs[m.segs.length - 2]?.name ?? "");

/**
 * The attributes a record is built with, less the owner ids of its path: pyactiveresource takes the keys of its prefix
 * (`Variant({"product_id": p})`) out of the attributes it sends. A value that is no dict literal is spread as it is.
 */
function builtEntries(m: IrSdkMatch, ctx: IrCtx): Entry[] {
  const built = wasRead(m) ? undefined : argOf(m.segs[m.segs.length - 2], 0);
  if (!built) return [];
  const d = deref(built.expr, built.fn, ctx);
  if (d.expr.k !== "dict") return [{ value: { k: "scoped", expr: built.expr, fn: built.fn }, spread: true }];
  const owners = new Set(Object.values(m.spec.params ?? {}).flatMap((s) => /^instance:0\.(\w+)$/.exec(s)?.[1] ?? []));
  owners.delete("id");
  const scoped = (e: Entry): Entry => ({ ...e, value: { k: "scoped", expr: e.value, fn: d.fn } });
  return d.expr.entries.filter((e) => !(e.key?.k === "str" && owners.has(e.key.v))).map(scoped);
}

/** The body a record's method sends: the attributes it is built with, then those set on it one by one. */
export function recordBody(m: IrSdkMatch, ctx: IrCtx): Scoped | undefined {
  const fn = m.method.fn;
  const entries = [...builtEntries(m, ctx), ...attributeEntries(m, ctx)];
  return fn && entries.length > 0 ? { expr: { k: "dict", entries }, fn } : undefined;
}

/** An attribute the code sets on the record before the call (`product.id = pid`), for a path placeholder. */
export function recordAttribute(m: IrSdkMatch, name: string, ctx: IrCtx): Scoped | undefined {
  const set = attributeEntries(m, ctx).filter((e) => e.key?.k === "str" && e.key.v === name && !e.optional);
  const last = set.at(-1);
  return last && m.method.fn ? { expr: last.value, fn: m.method.fn } : undefined;
}
