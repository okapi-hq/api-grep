import type { Arg, CallExpr, Entry, Expr, Pos } from "../ir/model.js";
import { appends, builtString, configRead, format, positional, uri } from "../jvm/calls.js";
import type { Lambda } from "./state.js";

/**
 * Calls that stand for a value the engine reads directly: configuration reads, string formatting and building,
 * collection literals, and scope functions (`let`, `run`, `apply`...) whose lambda gives the value.
 */

/** `buildString { append(a); append(b) }` and `StringBuilder(a).append(b).toString()`: the concatenation. */
function built(fn: Expr, lambda: Lambda | undefined): Expr | undefined {
  if (fn.k === "name" && fn.name === "buildString" && lambda) {
    const pieces = lambda.values.map(appends);
    if (pieces.length === 0 || pieces.some((p) => !p || p.root)) return undefined;
    return { k: "concat", parts: pieces.flatMap((p) => p!.items) };
  }
  return builtString(fn);
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
  return configRead(fn, args) ?? format(fn, args, "format") ?? built(fn, lambda) ?? collection(fn, args, pos) ?? scoped(fn, lambda, pos) ?? uri(fn, args);
}
