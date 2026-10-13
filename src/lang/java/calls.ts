import type { Arg, CallExpr, Entry, Expr, Pos } from "../ir/model.js";
import { builtString, configRead, format, pathOf, positional, uri } from "../jvm/calls.js";

/**
 * Java calls that stand for a value the engine reads directly: configuration reads (`System.getenv`, Spring's
 * `Environment.getProperty`), string formatting and joining, `StringBuilder` chains, collection factories
 * (`Map.of`, `List.of`) and defaults (`Optional.ofNullable(x).orElse(d)`).
 */

const values = (args: Arg[]): Expr[] => positional(args).map((a) => a.value);

/** `Map.of("a", 1, "b", x)`: keys and values alternate. */
function pairs(items: Expr[]): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i + 1 < items.length; i += 2) out.push({ key: items[i], value: items[i + 1]! });
  return out;
}

/** `Map.entry(k, v)` as a dict entry, else a spread of whatever it is. */
function entryOf(e: Expr): Entry {
  if (e.k === "call" && pathOf(e.fn)?.endsWith("Map.entry") && positional(e.args).length === 2) {
    const [k, v] = values(e.args);
    return { key: k, value: v! };
  }
  return { value: e, spread: true };
}

const MAPS = new Set(["Map.of", "ImmutableMap.of", "Collections.singletonMap"]);
const LISTS = new Set(["List.of", "Set.of", "Arrays.asList", "Collections.singletonList", "Collections.singleton", "ImmutableList.of", "Stream.of"]);
const EMPTY_MAPS = new Set(["Collections.emptyMap", "Map.of"]);

function collection(fn: Expr, args: Arg[]): Expr | undefined {
  const callee = pathOf(fn) ?? "";
  const items = values(args);
  if (items.length === 0 && EMPTY_MAPS.has(callee)) return { k: "dict", entries: [] };
  if (MAPS.has(callee)) return { k: "dict", entries: pairs(items) };
  if (callee === "Map.ofEntries") return { k: "dict", entries: items.map(entryOf) };
  if (LISTS.has(callee)) return { k: "list", items };
  return undefined;
}

/** `String.join("/", a, b)` and `String.join("/", parts)` read like `"/".join([a, b])`. */
function join(fn: Expr, args: Arg[], pos: Pos): Expr | undefined {
  if (pathOf(fn) !== "String.join") return undefined;
  const [sep, ...rest] = values(args);
  if (!sep || rest.length === 0) return undefined;
  const list: Expr = rest.length === 1 && rest[0]!.k !== "str" ? rest[0]! : { k: "list", items: rest };
  return { k: "call", fn: { k: "attr", obj: sep, name: "join", pos }, args: [{ value: list }], pos };
}

/** `Optional.ofNullable(x).orElse(d)`, `Objects.requireNonNullElse(x, d)`, `Objects.toString(x, d)`: `x`, else `d`. */
function orElse(fn: Expr, args: Arg[]): Expr | undefined {
  const [a, b] = values(args);
  const callee = pathOf(fn);
  if ((callee === "Objects.requireNonNullElse" || callee === "Objects.toString") && a && b) return { k: "or", left: a, right: b };
  if (fn.k !== "attr" || fn.name !== "orElse" || !a || fn.obj.k !== "call") return undefined;
  const inner = pathOf(fn.obj.fn);
  const value = values(fn.obj.args)[0];
  return (inner === "Optional.ofNullable" || inner === "Optional.of") && value ? { k: "or", left: value, right: a } : undefined;
}

/** Spring `environment.getProperty("api.url", "https://...")`, `Properties.getProperty(...)`: a configuration value. */
function property(fn: Expr, args: Arg[]): Expr | undefined {
  if (fn.k !== "attr" || (fn.name !== "getProperty" && fn.name !== "getRequiredProperty")) return undefined;
  const [a, b] = values(args);
  if (a?.k !== "str") return undefined;
  // `getProperty("x", String.class)` (Spring's typed overload) gives no default
  return { k: "env", name: a.v, ...(b && !isClassName(b) ? { fallback: b } : {}) };
}

/** `String` (from `String.class`), `Duration`: a class name, not a constant such as `DEFAULT_URL`. */
const isClassName = (e: Expr): boolean => /^[A-Z][a-z]/.test(e.k === "name" ? e.name : e.k === "attr" ? e.name : e.k === "qname" ? e.path[e.path.length - 1]! : "");

const TO_STRING = new Set(["String.valueOf", "Integer.toString", "Long.toString", "Double.toString", "Boolean.toString"]);

/** `String.valueOf(id)`, `Integer.toString(page)`: the value itself, as a query or path parameter reads it. */
const toText = (fn: Expr, args: Arg[]): Expr | undefined => (TO_STRING.has(pathOf(fn) ?? "") && positional(args).length === 1 ? positional(args)[0]!.value : undefined);

/** Positions of scheme, host and path in the multi-argument `URI` and `URL` constructors, by class and argument count. */
const URL_PARTS: Record<string, [number, number, number]> = {
  "URI/7": [0, 2, 4], // scheme, userInfo, host, port, path, query, fragment
  "URI/5": [0, 1, 2], // scheme, authority, path, query, fragment
  "URI/4": [0, 1, 2], // scheme, host, path, fragment
  "URL/4": [0, 1, 3], // protocol, host, port, file
  "URL/3": [0, 1, 2], // protocol, host, file
};

/**
 * `new URI(scheme, null, host, port, path, null, null)`, `new URL("https", host, path)`: the URL its parts make. The port
 * is left out (often `-1`, "none"), and so are the query and fragment.
 */
export function urlFromParts(call: CallExpr): Expr | undefined {
  const items = values(call.args);
  const at = URL_PARTS[`${pathOf(call.fn)?.replace(/^java\.net\./, "") ?? ""}/${items.length}`];
  if (!at) return undefined;
  const [scheme, host, path] = at.map((i) => items[i]!);
  return { k: "concat", parts: [scheme!, { k: "str", v: "://" }, host!, path!] };
}

/** The value a call stands for when it is one of the forms above; undefined for any other call. */
export function special(call: CallExpr): Expr | undefined {
  const { fn, args, pos } = call;
  return configRead(fn, args) ?? property(fn, args) ?? format(fn, args, "formatted") ?? builtString(fn) ?? collection(fn, args) ?? join(fn, args, pos) ?? orElse(fn, args) ?? toText(fn, args) ?? uri(fn, args);
}
