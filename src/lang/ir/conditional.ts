import { reachOf, type Reach } from "./edits.js";
import type { ScopedCall } from "./fluent.js";
import { dottedPath, type FunctionDef } from "./model.js";
import type { IrPair } from "./raw.js";
import { emptyParts, readSteps, type BuilderStep } from "./steps.js";

/**
 * Headers and query parameters set on some runs only of code that runs for each request (an interceptor, a filter,
 * #69): in a branch (`if (url.contains(...)) builder.header(...)`), a loop body, or after an early return
 * (`if (!allowed) return chain.proceed(request)`). They are `optional`, unless every branch of an `if` / `else` (or
 * an exhaustive `when`) sets the same name.
 */

/** Code that runs each time `root` runs; `skipped`: what calls it does so on some runs only. */
export interface RunScope {
  root: FunctionDef;
  skipped?: boolean;
}

const MAX_DEPTH = 16;

/** An early `return` in `fn` before `offset` that may run: the code at `offset` does not run then. */
const returnsBefore = (fn: FunctionDef, offset: number): boolean =>
  (fn.exits ?? []).some((x) => x.offset < offset && (x.maybe || reachOf(fn, x.offset, offset).kind !== "always"));

/** Methods that run the lambda they are given on some paths only, or once per element (a loop body). */
const SOMETIMES = new Set(["ifPresent", "forEach"]);

/** `token?.let { ... }`, `token.ifPresent(t -> builder.header(...))`, `extra.forEach { ... }`: the lambda `fn` may not run. */
const runsSometimes = (fn: FunctionDef, parent: FunctionDef): boolean =>
  !!fn.sometimes ||
  parent.calls.some((c) => c.fn.k === "attr" && SOMETIMES.has(c.fn.name) && c.args.some((a) => a.value.k === "fnref" && a.value.fn === fn));

/**
 * Whether the code at `offset` in `fn` (`root` or a closure written in it) runs each time `root` runs: always, in one
 * branch of an exhaustive chain, or maybe. A closure runs where it is written in its parent.
 */
export function reachIn(fn: FunctionDef, offset: number, root: FunctionDef): Reach {
  let reach: Reach = { kind: "always" };
  let f: FunctionDef | undefined = fn;
  let at = offset;
  for (let depth = 0; f && depth < MAX_DEPTH; depth++) {
    const r = reachOf(f, at, undefined);
    if (r.kind === "maybe" || returnsBefore(f, at)) return { kind: "maybe" };
    if (r.kind === "group") {
      // a branch inside a branch: not every path reaches it
      if (reach.kind !== "always") return { kind: "maybe" };
      reach = r;
    }
    if (f === root) break;
    if (f.parent && runsSometimes(f, f.parent)) return { kind: "maybe" };
    at = f.pos.offset;
    f = f.parent;
  }
  return reach;
}

/** A name as written, to tell the branches that set the same one: `"Accept"`, `HEADER_NAME`, `Headers.ACCEPT`. */
function nameKey(p: IrPair): string | undefined {
  const e = p.name.expr;
  const text = e.k === "str" ? e.v.toLowerCase() : dottedPath(e)?.join(".");
  return text === undefined ? undefined : `${p.where}:${text}`;
}

interface Group {
  size: number;
  seen: Set<number>;
  pairs: IrPair[];
}

/** Records a pair set in one branch of an exhaustive chain. */
function cover(groups: Map<string, Group>, p: IrPair, reach: Reach): void {
  const key = nameKey(p);
  if (reach.kind !== "group" || key === undefined) return;
  const id = `${key}@${reach.branch.group.id}`;
  const g = groups.get(id) ?? { size: reach.branch.group.size, seen: new Set<number>(), pairs: [] };
  groups.set(id, g);
  g.seen.add(reach.branch.start);
  g.pairs.push(p);
}

/**
 * The pairs the steps among `calls` make (`table`), those set on some runs of `scope.root` only marked `optional`. A
 * name every branch of an exhaustive chain sets is not optional.
 */
export function perRequestPairs(calls: ScopedCall[], table: Record<string, BuilderStep>, scope: RunScope): IrPair[] {
  const parts = emptyParts();
  const groups = new Map<string, Group>();
  for (const c of calls) {
    const from = parts.pairs.length;
    readSteps([c], table, parts);
    const reach: Reach = parts.pairs.length === from ? { kind: "always" } : scope.skipped ? { kind: "maybe" } : reachIn(c.fn, c.call.pos.offset, scope.root);
    if (reach.kind === "always") continue;
    for (let i = from; i < parts.pairs.length; i++) {
      const p = (parts.pairs[i] = { ...parts.pairs[i]!, optional: true });
      cover(groups, p, reach);
    }
  }
  for (const g of groups.values()) if (g.seen.size === g.size) for (const p of g.pairs) delete p.optional;
  return parts.pairs;
}
