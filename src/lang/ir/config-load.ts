import { isInterpolated, loadConfig, type ConfigValue, type LoadedConfig } from "../../model/config-files.js";
import { isSafeKey } from "../../record-keys.js";
import type { Entry, Expr, FunctionDef } from "./model.js";
import type { IrCtx } from "./raw.js";

/**
 * A config file the code loads by a literal path, as the IR expression of its value: dicts, lists and scalars, each
 * string marked with the file and key path it comes from (`model.sources`). Bounded: a large file is cut short.
 */

const MAX_NODES = 2_000;
const MAX_DEPTH = 10;
const exprCache = new WeakMap<LoadedConfig, Expr>();

function toExpr(v: ConfigValue, file: string, keys: string[], budget: { n: number }): Expr {
  if (--budget.n < 0) return { k: "unknown", text: "" };
  if (typeof v === "string") return isInterpolated(v) ? { k: "unknown", text: "" } : { k: "str", v, src: { from: "config_file", file, key: keys.join(".") } };
  if (typeof v === "number") return { k: "num", v };
  if (typeof v === "boolean") return { k: "bool", v };
  if (v === null || keys.length >= MAX_DEPTH) return { k: "null" };
  if (Array.isArray(v)) return { k: "list", items: v.map((x, i) => toExpr(x, file, [...keys, String(i)], budget)) };
  if (typeof v !== "object") return { k: "unknown", text: "" };
  const entries = Object.entries(v)
    .filter(([k]) => isSafeKey(k))
    .map(([k, x]): Entry => ({ key: { k: "str", v: k }, value: toExpr(x, file, [...keys, k], budget) }));
  return { k: "dict", entries };
}

/** The value of the config file `literal` names, loaded from `fn`'s file. */
export function loadedConfigExpr(literal: string, fn: FunctionDef, ctx: IrCtx): Expr | undefined {
  const root = ctx.idx.rootDir ?? ctx.rootDir;
  const loaded = root ? loadConfig(literal, fn.module.file, root) : undefined;
  if (!loaded) return undefined;
  let expr = exprCache.get(loaded);
  if (!expr) exprCache.set(loaded, (expr = toExpr(loaded.data, loaded.file, [], { n: MAX_NODES })));
  return expr;
}
