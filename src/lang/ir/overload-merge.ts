import { partsToTemplate, staticText } from "../../resolve/parts.js";
import { evaluate } from "./evaluate.js";
import type { Scoped } from "./language.js";
import { withSelf, withSubst, type IrCtx, type IrPair, type IrRaw } from "./raw.js";

/**
 * A call whose arguments fit several overloads (`execute(agent, headers, verb, url, payload)` with a payload of unknown
 * type): each overload's request is read, and the call keeps what they agree on. A value they disagree on is unknown,
 * the method `DYNAMIC` when theirs differ.
 */

const unknown = (text: string, at: Scoped | undefined, raw: IrRaw): Scoped => ({ expr: { k: "unknown", text }, fn: at?.fn ?? raw.fn });

/** What a value reads as in its raw's context: its template, or a marker when absent. */
function textOf(s: Scoped | undefined, raw: IrRaw, ctx: IrCtx): string {
  if (!s) return "<none>";
  return partsToTemplate(evaluate(s.expr, s.fn, withSelf(withSubst(ctx, raw.subst), raw.self)));
}

function methodOf(raw: IrRaw, ctx: IrCtx): string | undefined {
  if (raw.impliedMethod) return raw.impliedMethod.toUpperCase();
  if (!raw.method) return "GET";
  return staticText(evaluate(raw.method.expr, raw.method.fn, withSelf(withSubst(ctx, raw.subst), raw.self)))?.toUpperCase();
}

const same = (values: string[]): boolean => values.every((v) => v === values[0]);

/** The pairs every raw has (by place and name), a value they disagree on unknown. */
function commonPairs(raws: IrRaw[], ctx: IrCtx): IrPair[] {
  const first = raws[0]!;
  const key = (p: IrPair, r: IrRaw): string => `${p.where}:${textOf(p.name, r, ctx)}`;
  const out: IrPair[] = [];
  for (const p of first.pairs ?? []) {
    const k = key(p, first);
    const matches = raws.map((r) => (r.pairs ?? []).find((q) => key(q, r) === k));
    if (matches.some((m) => !m)) continue;
    const values = matches.map((m, i) => textOf(m!.value, raws[i]!, ctx));
    out.push(same(values) ? p : { ...p, value: unknown("value", p.value, first) });
  }
  return out;
}

/** One raw for the requests of a call's overloads, reached through the same call of the same wrapper chain. */
export function mergeOverloads(raws: IrRaw[], ctx: IrCtx): IrRaw {
  const first = raws[0]!;
  if (raws.length === 1) return first;
  const urls = raws.map((r) => `${textOf(r.baseUrl, r, ctx)} ${textOf(r.url, r, ctx)}`);
  const bodies = raws.map((r) => `${r.bodyRole ?? ""} ${r.encoding ?? ""} ${textOf(r.body, r, ctx)}`);
  const headers = raws.map((r) => r.headers.map((h) => textOf(h, r, ctx)).join("|"));
  const queries = raws.map((r) => textOf(r.query, r, ctx));
  const methods = raws.map((r) => methodOf(r, ctx) ?? "?");
  const known = same(methods) && methods[0] !== "?";
  return {
    ...first,
    ...(same(urls) ? {} : { url: unknown("url", first.url, first), baseUrl: undefined, urlJoin: undefined }),
    ...(known ? {} : { method: unknown("method", first.method, first), impliedMethod: undefined }),
    // bodies the overloads encode differently: bytes sent as they are, no structure claimed
    ...(same(bodies) ? {} : { body: unknown("body", first.body, first), encoding: same(raws.map((r) => r.encoding ?? "")) ? first.encoding : "raw" }),
    headers: same(headers) ? first.headers : [],
    ...(same(queries) ? {} : { query: undefined }),
    pairs: commonPairs(raws, ctx),
    alternatives: undefined,
  };
}
