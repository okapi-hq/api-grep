import type { Scoped } from "../../ir/language.js";
import type { Expr, FunctionDef } from "../../ir/model.js";
import type { IrCtx } from "../../ir/raw.js";
import { COLLECTIONS, diIndex, type Framework, type Provider } from "./providers.js";
import { generic, sameType, typeKey } from "./types.js";

/** Where a value is injected: by which container, with which qualifiers, under which name (Spring's fallback). */
export interface Point {
  framework: Framework;
  quals: string[];
  name?: string;
}

/** The bindings of `type` (as declared in `fn`) in the injection point's container; never one of `fn`'s own. */
export function candidates(type: Expr, at: Point, fn: FunctionDef, ctx: IrCtx): Provider[] | undefined {
  const key = typeKey(type, fn, ctx);
  if (!key) return undefined;
  return (diIndex(ctx).byName.get(key.simple.split(".").pop()!) ?? []).filter((p) => p.fn !== fn && p.framework === at.framework && sameType(p.key, key));
}

const sameQuals = (p: Provider, at: Point): boolean => p.quals.length === at.quals.length && at.quals.every((q) => p.quals.includes(q));

/**
 * An injected collection (#75): Spring's `List<ClientHttpRequestInterceptor>` is every bean of the element type (those
 * with the point's qualifier when it has one); a Dagger / kotlin-inject `Set<Interceptor>` is the `@IntoSet` and
 * `@ElementsIntoSet` contributions, or the one provider of the whole set. A list of the bindings' values, each read where
 * it is written; unknown when one of them cannot be read, or when contributions and a whole set are both provided.
 */
export function collected(type: Expr | undefined, at: Point, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const g = generic(type);
  const cands = g && COLLECTIONS.has(g.name) ? candidates(g.arg, at, fn, ctx) : undefined;
  if (!cands) return undefined;
  let items: Provider[];
  if (at.framework === "spring") items = cands.filter((p) => !p.bag && (at.quals.length === 0 || sameQuals(p, at)));
  else {
    const own = cands.filter((p) => sameQuals(p, at));
    const whole = own.filter((p) => p.bag === "plain");
    const parts = own.filter((p) => p.bag === "into" || p.bag === "elements");
    items = whole.length === 0 ? parts : whole.length === 1 && parts.length === 0 ? whole : [];
  }
  if (items.length === 0 || items.some((p) => !p.value)) return undefined;
  if (items.length === 1 && items[0]!.bag === "plain") return items[0]!.value;
  return { expr: { k: "list", items: items.map((p): Expr => ({ k: "scoped", expr: p.value!.expr, fn: p.value!.fn })) }, fn };
}
