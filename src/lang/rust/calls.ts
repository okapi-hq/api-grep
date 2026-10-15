import type { Arg, Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { posOf, type RustState } from "./names.js";
import { resolveSegments, segmentsOf } from "./paths.js";

/**
 * Calls the lowering reads as values rather than calls: conversions and wrappers that stand for their operand
 * (`.clone()`, `.to_string()`, `.unwrap()`, `?`'s helpers, `Arc::new(x)`, `Some(x)`, `String::from(x)`), defaults
 * (`.unwrap_or(d)`, `.unwrap_or_else(|_| d)`), environment reads (`std::env::var("X")`, `dotenvy::var`), maps built
 * from pairs (`HashMap::from([(k, v)])`), URL joins (`Url::parse(base)?.join(p)`) and strings built in place
 * (`s.push_str(x)`).
 */

/** Lowering hooks, set by lower-expr.ts. */
export interface Hooks {
  expr: (n: SyntaxNode, st: RustState) => Expr;
  args: (n: SyntaxNode | undefined, st: RustState) => Arg[];
  /** The value a closure gives (`|_| "d".into()`), lowered in the current function. */
  closureValue: (n: SyntaxNode, st: RustState) => Expr;
}

/** Methods without arguments that stand for their receiver. */
const SAME0 = new Set([
  "clone", "to_string", "to_owned", "into", "as_str", "as_ref", "as_deref", "as_mut", "unwrap", "borrow", "borrow_mut", "lock", "ok",
  "into_owned", "unwrap_or_default", "parse", "to_vec", "as_bytes", "into_bytes", "trim", "to_lowercase", "into_inner", "as_slice",
]);
/** Methods with one argument that stand for their receiver (error handling, trimming). */
const SAME1 = new Set(["expect", "context", "with_context", "map_err", "ok_or", "ok_or_else", "trim_end_matches", "trim_start_matches", "trim_matches", "wrap_err", "wrap_err_with", "attach_printable"]);

/** `Type::function(x)` standing for `x`, by the type's last segment. */
const WRAPPING: Record<string, Set<string>> = {
  Arc: new Set(["new", "from"]),
  Rc: new Set(["new", "from"]),
  Box: new Set(["new", "from", "pin"]),
  Mutex: new Set(["new"]),
  RwLock: new Set(["new"]),
  RefCell: new Set(["new"]),
  Cell: new Set(["new"]),
  Cow: new Set(["Borrowed", "Owned", "from"]),
  String: new Set(["from", "from_str"]),
  Url: new Set(["parse"]),
  HeaderValue: new Set(["from_str", "from_static", "try_from"]),
  HeaderName: new Set(["from_static", "from_str", "try_from"]),
  Value: new Set(["from", "String"]),
  Some: new Set(),
};
/** Variants and functions of the prelude standing for their argument. */
const WRAPPING_FNS = new Set(["Some", "Ok", "From::from"]);
/** `Lazy::new(|| expr)`: the value the closure gives. */
const LAZY = new Set(["Lazy", "LazyLock", "LazyCell"]);
const MAPS = new Set(["HashMap", "BTreeMap", "IndexMap", "HeaderMap", "Map"]);

/** Environment reads, by the end of their absolute path. */
const ENV_READS = ["std.env.var", "std.env.var_os", "env.var", "dotenvy.var", "dotenv.var", "dotenvy.var_os", "dotenv.var_os"];

/** A list of `(key, value)` tuples as a dict (`HashMap::from([("role", "user")])`, `.form(&[("a", b)])`). */
export function pairsDict(e: Expr): Expr | undefined {
  if (e.k !== "list" || e.items.length === 0) return undefined;
  if (!e.items.every((p) => p.k === "list" && p.items.length === 2)) return undefined;
  return { k: "dict", entries: e.items.map((p) => ({ key: (p as { items: Expr[] }).items[0]!, value: (p as { items: Expr[] }).items[1]! })) };
}

function pathCall(fnNode: SyntaxNode, argsNode: SyntaxNode | undefined, st: RustState, h: Hooks): Expr | undefined {
  const segs = segmentsOf(fnNode);
  if (!segs || segs.length === 0) return undefined;
  const args = argsNode ? named(argsNode).filter((a) => !a.type.endsWith("comment")) : [];
  const [last, owner] = [segs.at(-1)!, segs.at(-2)];
  if (owner === "String" && (last === "new" || last === "with_capacity")) return { k: "str", v: "" };
  if (args.length === 1 && segs.length === 1 && WRAPPING_FNS.has(last)) return h.expr(args[0]!, st);
  if (args.length === 1 && owner && WRAPPING[owner]?.has(last)) return h.expr(args[0]!, st);
  if (args.length === 1 && owner && LAZY.has(owner) && last === "new" && args[0]!.type === "closure_expression") return h.closureValue(args[0]!, st);
  const r = resolveSegments(segs, st.file, st.locals);
  const abs = r.kind === "abs" ? r.path.join(".") : segs.join(".");
  if (args.length === 1 && ENV_READS.some((p) => abs === p || abs.endsWith(`.${p}`))) {
    const name = h.expr(args[0]!, st);
    if (name.k === "str") return { k: "env", name: name.v };
  }
  if (args.length === 1 && owner && MAPS.has(owner) && (last === "from" || last === "from_iter")) return pairsDict(h.expr(args[0]!, st));
  return undefined;
}

/** `[a, b].join("/")`: the items with the separator between them; `url.join(p)` on a parsed URL: an RFC 3986 join. */
function joinCall(recv: SyntaxNode, obj: Expr, arg: Expr, st: RustState): Expr | undefined {
  if (obj.k === "list" && arg.k === "str") return { k: "concat", parts: obj.items.flatMap((x, i) => (i ? [arg, x] : [x])) };
  const parsedUrl = (recv.type === "identifier" && st.urls.has(recv.text)) || /\bUrl::parse\s*\(/.test(recv.text.slice(0, 200));
  return parsedUrl ? { k: "call", fn: { k: "name", name: "urljoin", pos: posOf(recv) }, args: [{ value: obj }, { value: arg }], pos: posOf(recv) } : undefined;
}

const DEFAULTS = new Set(["unwrap_or", "unwrap_or_else"]);

function methodCall(n: SyntaxNode, fnNode: SyntaxNode, argsNode: SyntaxNode | undefined, st: RustState, h: Hooks): Expr | undefined {
  const name = field(fnNode, "field")?.text;
  const recv = field(fnNode, "value");
  if (!name || !recv) return undefined;
  const args = argsNode ? named(argsNode).filter((a) => !a.type.endsWith("comment")) : [];
  const one = args.length === 1;
  if (!(SAME0.has(name) && args.length === 0) && !(one && (SAME1.has(name) || DEFAULTS.has(name) || name === "join" || name === "push_str"))) return undefined;
  const obj = h.expr(recv, st);
  if (args.length === 0) return obj;
  const arg = args[0]!;
  if (name === "unwrap_or_else" && arg.type === "closure_expression") return { k: "or", left: obj, right: h.closureValue(arg, st) };
  const value = h.expr(arg, st);
  // the closure or message of an error helper is code too: its calls are recorded
  if (SAME1.has(name)) return obj;
  if (DEFAULTS.has(name)) return { k: "or", left: obj, right: value };
  if (name === "join") {
    const joined = joinCall(recv, obj, value, st);
    if (joined) return joined;
    const call: Expr = { k: "call", fn: { k: "attr", obj, name, pos: posOf(fnNode) }, args: [{ value }], pos: posOf(n) };
    st.fn.calls.push(call);
    return call;
  }
  // `url.push_str("/v1")`: the string grows
  if (recv.type === "identifier") st.fn.assigns.push({ target: recv.text, value, offset: fnNode.endIndex, augmented: true });
  return { k: "unknown", text: "()" };
}

/** The value a call stands for, when the lowering reads it as one; undefined for a call to record. */
export function specialCall(n: SyntaxNode, st: RustState, h: Hooks): Expr | undefined {
  let fnNode = field(n, "function");
  if (fnNode?.type === "generic_function") fnNode = field(fnNode, "function");
  if (!fnNode) return undefined;
  const argsNode = field(n, "arguments");
  if (fnNode.type === "field_expression") return methodCall(n, fnNode, argsNode, st, h);
  return pathCall(fnNode, argsNode, st, h);
}
