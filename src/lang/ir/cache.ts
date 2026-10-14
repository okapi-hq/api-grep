import type { Scoped } from "./language.js";
import type { Expr, FunctionDef } from "./model.js";
import { lookup } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * Clients a helper keeps in a module's dict (#98): `_clients[chain_id] = Web3(...)` on first use, then
 * `return _clients[chain_id]` (also `_clients.get(chain_id)`, `setdefault`). An entry the code reads with a key the
 * scan cannot tell may be any value written into the dict: its initial entries and every `d[k] = v` of the module's
 * functions. The caller decides what they are; an entry that cannot be read (a spread) leaves the dict unread.
 */

/** Values read per dict: a bound on hostile input. */
const MAX_VALUES = 8;

/** `_clients[k]`, `_clients.get(k)`: the dict variable read, when it is one. */
function readName(e: Expr): Extract<Expr, { k: "name" }> | undefined {
  if (e.k === "index") return e.obj.k === "name" ? e.obj : undefined;
  const get = e.k === "call" && e.fn.k === "attr" && e.fn.name === "get" && e.args.length >= 1 ? e.fn.obj : undefined;
  return get?.k === "name" ? get : undefined;
}

/** A function of its own with a local of that name writes into the local, not the module's dict. */
const shadows = (f: FunctionDef, name: string): boolean => f.assigns.some((a) => a.target === name && !a.edit) || f.params.some((p) => p.name === name);

/** Every value a module-level dict may hold, for an entry read with a key known at run time; undefined for anything else. */
export function cachedEntries(e: Expr, fn: FunctionDef, ctx: IrCtx): Scoped[] | undefined {
  const name = readName(e);
  const b = name ? lookup(name.name, fn, name.pos.offset, ctx.idx) : undefined;
  if (!name || b?.kind !== "value" || b.fn !== b.fn.module.top || b.assign.value.k !== "dict") return undefined;
  const top = b.fn;
  // the module's own statements are folded into the dict already
  const out: Scoped[] = [];
  for (const en of b.assign.value.entries) {
    if (en.spread) return undefined;
    out.push({ expr: en.value, fn: top });
  }
  for (const f of top.module.allFunctions) {
    if (f === top || shadows(f, name.name)) continue;
    for (const a of f.assigns) {
      if (a.target !== name.name || (a.edit !== "merge" && a.edit !== "default") || a.value.k !== "dict") continue;
      for (const en of a.value.entries) {
        if (en.spread) return undefined;
        out.push({ expr: en.value, fn: f });
      }
    }
  }
  return out.length > 0 && out.length <= MAX_VALUES ? out : undefined;
}

/** Two expressions written the same way (positions aside): `Web3(HTTPProvider(URL))` in two branches is one client. */
export function sameExpr(a: Expr, b: Expr): boolean {
  const text = (e: Expr): string =>
    JSON.stringify(e, (k, v: unknown) => {
      if (k === "pos") return undefined;
      // a function: by where it is, not its contents (they refer back to the module)
      if (v && typeof v === "object" && "assigns" in v && "module" in v) return `fn@${(v as FunctionDef).module.file}:${(v as FunctionDef).pos.offset}`;
      return v;
    });
  return text(a) === text(b);
}
