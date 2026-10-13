import { callsOn, scopedIn } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import type { Entry, FunctionDef } from "../../ir/model.js";
import { lookup } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { calleeIs } from "../../ir/steps.js";
import { deref } from "../../ir/values.js";

/** The classes of a name-value pair (`BasicNameValuePair`), the lists they are gathered in and how items are added. */
export interface PairLists {
  items: string[];
  lists: string[];
  add: string[];
}

/** The items of a list: a literal (`List.of(...)`, `Arrays.asList(...)`), or a list variable filled with `add(...)` before `at`. */
function listItems(s: Scoped, spec: PairLists, ctx: IrCtx): Scoped[] | undefined {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k === "list") return d.expr.items.map((expr) => ({ expr, fn: d.fn }));
  if (s.expr.k !== "name") return undefined;
  const b = lookup(s.expr.name, s.fn, s.expr.pos.offset, ctx.idx);
  if (b.kind !== "value" || b.assign.value.k !== "call" || calleeIs(b.assign.value, spec.lists) === undefined) return undefined;
  const at = s.expr.pos.offset;
  return callsOn(b.fn, s.expr.name, b.assign.offset)
    .filter((c) => (b.fn !== s.fn || c.call.pos.offset < at) && calleeIs(c.call, spec.add) !== undefined && c.call.args.length === 1)
    .map((c) => ({ expr: c.call.args[0]!.value, fn: c.fn }));
}

/**
 * A form body given as name-value pairs (`new UrlEncodedFormEntity(params)` with `params.add(new BasicNameValuePair("k",
 * v))`): the dict of the pairs, read in the function of `s`; undefined when the value is not such a list.
 */
export function nameValuePairs(s: Scoped, spec: PairLists, ctx: IrCtx): Scoped | undefined {
  const items = listItems(s, spec, ctx);
  const into: FunctionDef = s.fn;
  const entries: Entry[] = [];
  for (const item of items ?? []) {
    const d = deref(item.expr, item.fn, ctx);
    const pair = d.expr.k === "call" && calleeIs(d.expr, spec.items) !== undefined ? d.expr.args.filter((a) => !a.name && !a.spread) : [];
    const [k, v] = pair.map((a) => a.value);
    if (k && v) entries.push({ key: scopedIn(k, d.fn, into), value: scopedIn(v, d.fn, into) });
  }
  return entries.length > 0 ? { expr: { k: "dict", entries }, fn: into } : undefined;
}
