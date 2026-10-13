import { dottedPath, type Arg, type Expr } from "../ir/model.js";

/**
 * JDK calls that stand for a value the engine reads directly, the same in Kotlin and Java: configuration reads, string
 * formatting, `StringBuilder` chains and `URI.create`.
 */

export const positional = (args: Arg[]): Arg[] => args.filter((a) => !a.name && !a.spread);
const literal = (a: Arg | undefined): string | undefined => (a && a.value.k === "str" ? a.value.v : undefined);
export const pathOf = (e: Expr): string | undefined => dottedPath(e)?.join(".").replace(/^java\.lang\./, "");

/** `System.getenv()`: the whole environment as a map. */
export const isEnvMap = (e: Expr): boolean => e.k === "call" && e.args.length === 0 && pathOf(e.fn) === "System.getenv";

/** `System.getenv("X")`, `System.getProperty("x", "d")`, `System.getenv().getOrDefault("X", "d")`, `System.getenv().get("X")`. */
export function configRead(fn: Expr, args: Arg[]): Expr | undefined {
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

const isLocale = (e: Expr): boolean => (dottedPath(e.k === "call" ? e.fn : e)?.[0] ?? "") === "Locale";

/** `String.format("%s/v1", base)` (a leading `Locale` aside), Kotlin `"%s/v1".format(base)`, Java `"%s/v1".formatted(base)`. */
export function format(fn: Expr, args: Arg[], method: "format" | "formatted"): Expr | undefined {
  if (pathOf(fn) === "String.format") {
    const rest = args[0] && isLocale(args[0].value) ? args.slice(1) : args;
    return rest[0] && !rest[0].spread ? { k: "format", style: "printf", template: rest[0].value, args: rest.slice(1) } : undefined;
  }
  if (fn.k === "attr" && fn.name === method && ["str", "tmpl", "name", "attr"].includes(fn.obj.k)) return { k: "format", style: "printf", template: fn.obj, args };
  return undefined;
}

/** `sb.append(a).append(b)` -> the root (`sb`, none for a bare `append` in `buildString`) and `[a, b]`. */
export function appends(e: Expr): { root?: Expr; items: Expr[] } | undefined {
  if (e.k !== "call" || (e.fn.k !== "name" && e.fn.k !== "attr") || e.fn.name !== "append") return undefined;
  const arg = positional(e.args)[0]?.value;
  if (!arg) return undefined;
  if (e.fn.k === "name") return { items: [arg] };
  const inner = appends(e.fn.obj) ?? { root: e.fn.obj, items: [] };
  return { root: inner.root, items: [...inner.items, arg] };
}

/** `StringBuilder` (Kotlin `StringBuilder(a)`, Java `new StringBuilder(a)`): its constructor's text, if it is one. */
export function stringBuilderStart(e: Expr | undefined): Expr[] | undefined {
  if (!e || e.k !== "call" || pathOf(e.fn) !== "StringBuilder") return undefined;
  // `new StringBuilder(64)` is a capacity, not text
  return positional(e.args)
    .map((a) => a.value)
    .filter((v) => v.k !== "num");
}

/** `StringBuilder(a).append(b).toString()`: the concatenation. */
export function builtString(fn: Expr): Expr | undefined {
  if (fn.k !== "attr" || fn.name !== "toString") return undefined;
  const chain = appends(fn.obj);
  const start = stringBuilderStart(chain?.root);
  return start && chain ? { k: "concat", parts: [...start, ...chain.items] } : undefined;
}

/** `URI.create(url)` (an SDK's `endpointOverride`, a base URL): the URL itself. */
export function uri(fn: Expr, args: Arg[]): Expr | undefined {
  const callee = pathOf(fn);
  return callee === "URI.create" || callee === "java.net.URI.create" ? positional(args)[0]?.value : undefined;
}
