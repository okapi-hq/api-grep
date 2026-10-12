import { dottedPath, type Arg, type CallExpr, type Entry, type Expr, type Pos } from "../ir/model.js";
import type { Lambda } from "./state.js";

/**
 * Calls that stand for a value the engine reads directly: configuration reads, string formatting and building,
 * collection literals, and scope functions (`let`, `run`, `apply`...) whose lambda gives the value.
 */

const positional = (args: Arg[]): Arg[] => args.filter((a) => !a.name && !a.spread);
const literal = (a: Arg | undefined): string | undefined => (a && a.value.k === "str" ? a.value.v : undefined);
const pathOf = (e: Expr): string | undefined => dottedPath(e)?.join(".").replace(/^java\.lang\./, "");

/** `System.getenv("X")`, `System.getProperty("x", "d")`, `System.getenv().getOrDefault("X", "d")`, `System.getenv()["X"]`. */
function configRead(fn: Expr, args: Arg[]): Expr | undefined {
  const [a, b] = positional(args);
  const name = literal(a);
  if (name === undefined) return undefined;
  const callee = pathOf(fn);
  if (callee === "System.getenv") return { k: "env", name };
  if (callee === "System.getProperty") return { k: "env", name, ...(b ? { fallback: b.value } : {}) };
  if (fn.k === "attr" && (fn.name === "get" || fn.name === "getOrDefault") && isEnvMap(fn.obj)) {
    return { k: "env", name, ...(fn.name === "getOrDefault" && b ? { fallback: b.value } : {}) };
  }
  return undefined;
}

/** `System.getenv()`: the whole environment as a map. */
export const isEnvMap = (e: Expr): boolean => e.k === "call" && e.args.length === 0 && pathOf(e.fn) === "System.getenv";

const isLocale = (e: Expr): boolean => (dottedPath(e.k === "call" ? e.fn : e)?.[0] ?? "") === "Locale";

/** `String.format("%s/v1", base)` (a leading `Locale` aside) and `"%s/v1".format(base)`. */
function format(fn: Expr, args: Arg[]): Expr | undefined {
  if (pathOf(fn) === "String.format") {
    const rest = args[0] && isLocale(args[0].value) ? args.slice(1) : args;
    return rest[0] && !rest[0].spread ? { k: "format", style: "printf", template: rest[0].value, args: rest.slice(1) } : undefined;
  }
  if (fn.k === "attr" && fn.name === "format" && ["str", "tmpl", "name", "attr"].includes(fn.obj.k)) return { k: "format", style: "printf", template: fn.obj, args };
  return undefined;
}

/** `sb.append(a).append(b)` -> the root (`sb`, none for a bare `append` in `buildString`) and `[a, b]`. */
function appends(e: Expr): { root?: Expr; items: Expr[] } | undefined {
  if (e.k !== "call" || (e.fn.k !== "name" && e.fn.k !== "attr") || e.fn.name !== "append") return undefined;
  const arg = positional(e.args)[0]?.value;
  if (!arg) return undefined;
  if (e.fn.k === "name") return { items: [arg] };
  const inner = appends(e.fn.obj) ?? { root: e.fn.obj, items: [] };
  return { root: inner.root, items: [...inner.items, arg] };
}

/** `buildString { append(a); append(b) }` and `StringBuilder(a).append(b).toString()`: the concatenation. */
function built(fn: Expr, lambda: Lambda | undefined): Expr | undefined {
  if (fn.k === "name" && fn.name === "buildString" && lambda) {
    const pieces = lambda.values.map(appends);
    if (pieces.length === 0 || pieces.some((p) => !p || p.root)) return undefined;
    return { k: "concat", parts: pieces.flatMap((p) => p!.items) };
  }
  if (fn.k !== "attr" || fn.name !== "toString") return undefined;
  const chain = appends(fn.obj);
  const root = chain?.root;
  if (!root || root.k !== "call" || pathOf(root.fn) !== "StringBuilder") return undefined;
  return { k: "concat", parts: [...positional(root.args).map((a) => a.value), ...chain.items] };
}

const LISTS = new Set(["listOf", "mutableListOf", "arrayListOf", "arrayOf", "setOf", "mutableSetOf", "hashSetOf", "linkedSetOf", "listOfNotNull", "emptyList"]);
const MAPS = new Set(["mapOf", "mutableMapOf", "hashMapOf", "linkedMapOf", "sortedMapOf", "emptyMap"]);

/** `a to b` lowers to a two-item list: a map entry in `mapOf(...)`. */
function entry(a: Arg): Entry {
  return a.value.k === "list" && a.value.items.length === 2 && !a.spread ? { key: a.value.items[0], value: a.value.items[1]! } : { value: a.value, spread: true };
}

function collection(fn: Expr, args: Arg[], pos: Pos): Expr | undefined {
  if (fn.k === "name" && LISTS.has(fn.name)) return { k: "list", items: args.map((a) => a.value) };
  if (fn.k === "name" && MAPS.has(fn.name)) return { k: "dict", entries: args.map(entry) };
  // `listOf(a, b).joinToString("/")` reads like `"/".join([a, b])`
  if (fn.k === "attr" && fn.name === "joinToString") {
    const sep = positional(args)[0]?.value ?? args.find((a) => a.name === "separator")?.value ?? { k: "str", v: ", " };
    return { k: "call", fn: { k: "attr", obj: sep, name: "join", pos }, args: [{ value: fn.obj }], pos };
  }
  return undefined;
}

const RESULT_OF_LAMBDA = new Set(["lazy", "run", "with", "withContext", "runBlocking", "coroutineScope", "synchronized"]);
const RECEIVER_TO_LAMBDA = new Set(["let", "use", "run"]);
const RECEIVER = new Set(["apply", "also", "takeIf", "takeUnless"]);

/**
 * `x.let { ... }`, `run { ... }`, `withContext(io) { ... }`, `lazy { ... }`: what the lambda returns, read as a call of
 * it; `it` stands for `x`. `x.apply { ... }` and `x.also { ... }` are `x`.
 */
function scoped(fn: Expr, lambda: Lambda | undefined, pos: Pos): Expr | undefined {
  if (!lambda) return undefined;
  const invoke: CallExpr = { k: "call", fn: { k: "fnref", fn: lambda.fn }, args: [], pos };
  const it = lambda.fn.params[0];
  if (fn.k === "attr" && (RECEIVER_TO_LAMBDA.has(fn.name) || RECEIVER.has(fn.name))) {
    if (it && fn.name !== "run" && fn.name !== "apply") it.default ??= fn.obj;
    return RECEIVER.has(fn.name) ? fn.obj : invoke;
  }
  return fn.k === "name" && RESULT_OF_LAMBDA.has(fn.name) ? invoke : undefined;
}

/** The value a call stands for when it is one of the forms above; undefined for any other call. */
export function special(fn: Expr, args: Arg[], lambda: Lambda | undefined, pos: Pos): Expr | undefined {
  return configRead(fn, args) ?? format(fn, args) ?? built(fn, lambda) ?? collection(fn, args, pos) ?? scoped(fn, lambda, pos);
}
