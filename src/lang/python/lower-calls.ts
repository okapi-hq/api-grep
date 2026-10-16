import type { Arg, CallExpr, Expr, Pos } from "../ir/model.js";
import type { PyState } from "./lower-expr.js";

/** The dotted name a callee stands for through the module's imports (`ft.partial` -> `functools.partial`). */
function qualified(callee: string, st: PyState): string {
  const [head, ...rest] = callee.split(".");
  const ref = st.mod.imports.get(head!);
  return ref ? [...ref.path, ...rest].join(".") : callee;
}

const positional = (args: Arg[]): Arg[] => args.filter((a) => !a.name && !a.spread);

/** `functools.partial(fn, *a, **kw)`, also held by a local of the function: the function and the arguments it is bound to. */
function partialOf(e: Expr, st: PyState): { fn: Expr; args: Arg[] } | undefined {
  if (e.k === "name") {
    const held = st.fn.assigns.filter((a) => a.target === e.name && !a.edit && a.offset < e.pos.offset).pop()?.value;
    return held && held.k === "call" ? partialOf(held, st) : undefined;
  }
  if (e.k !== "call") return undefined;
  const name = dottedName(e.fn);
  if (!name || qualified(name, st) !== "functools.partial") return undefined;
  const [first, ...rest] = e.args;
  return first && !first.name && !first.spread ? { fn: first.value, args: rest } : undefined;
}

function dottedName(e: Expr): string | undefined {
  if (e.k === "name") return e.name;
  if (e.k !== "attr") return undefined;
  const head = dottedName(e.obj);
  return head ? `${head}.${e.name}` : undefined;
}

/** A function and the arguments it is run with, a bound `partial` unwrapped. */
function runs(fn: Expr, args: Arg[], st: PyState): { fn: Expr; args: Arg[] } {
  const bound = partialOf(fn, st);
  return bound ? { fn: bound.fn, args: [...bound.args, ...args] } : { fn, args };
}

/**
 * A call a standard helper makes for the code: `asyncio.to_thread(client.messages.create, model=m)`,
 * `loop.run_in_executor(None, partial(fn, ...))` and a `partial` called later run `fn` with those arguments, so they
 * read as that call.
 */
export function forwardedCall(callee: string | undefined, fn: Expr, args: Arg[], st: PyState): { fn: Expr; args: Arg[] } | undefined {
  // `call = partial(client.messages.create, model=m)` then `call(messages=...)`
  if (fn.k === "name" && partialOf(fn, st)) return runs(fn, args, st);
  if (callee && qualified(callee, st) === "asyncio.to_thread") {
    const [first, ...rest] = args;
    return first && !first.name && !first.spread ? runs(first.value, rest, st) : undefined;
  }
  if (fn.k === "attr" && fn.name === "run_in_executor") {
    const pos = positional(args);
    if (pos.length < 2 || pos[0] !== args[0] || pos[1] !== args[1]) return undefined;
    return runs(args[1]!.value, args.slice(2), st);
  }
  return undefined;
}

/**
 * A value written as a call that stands for another: `getattr(obj, "name")` is `obj.name`; a dataclass or pydantic
 * field's default (`field(default_factory=OpenAI)`, `Field(default=...)`) is the value the instance gets.
 */
export function valueCall(callee: string | undefined, args: Arg[], st: PyState, pos: Pos): Expr | undefined {
  if (!callee) return undefined;
  if (callee === "getattr" && !st.mod.imports.has("getattr")) {
    const pos2 = positional(args);
    const name = pos2[1]?.value;
    return args.length <= 3 && pos2.length === args.length && pos2[0] && name?.k === "str" && /^[A-Za-z_]\w*$/.test(name.v) ? { k: "attr", obj: pos2[0].value, name: name.v, pos } : undefined;
  }
  const q = qualified(callee, st);
  if (q !== "dataclasses.field" && q !== "pydantic.Field" && q !== "pydantic.fields.Field") return undefined;
  const factory = args.find((a) => a.name === "default_factory")?.value;
  if (factory) return { k: "call", fn: factory, args: [], pos };
  // `Field("gpt-4o", description=...)`: pydantic's default is its first argument (`...` marks a required field)
  const first = q === "dataclasses.field" ? undefined : args[0] && !args[0].name && !args[0].spread ? args[0].value : undefined;
  return args.find((a) => a.name === "default")?.value ?? (first && !(first.k === "unknown" && first.text === "...") ? first : undefined);
}

/**
 * `executor.submit(fn, *args, **kw)` (`concurrent.futures`) runs `fn` with those arguments later: that call too, kept
 * beside the `submit` call itself (a project's own `submit` method stays a call of its own).
 */
export function submittedCall(fn: Expr, args: Arg[], st: PyState, pos: Pos): CallExpr | undefined {
  if (fn.k !== "attr" || fn.name !== "submit") return undefined;
  const [first, ...rest] = args;
  if (!first || first.name || first.spread || (first.value.k !== "name" && first.value.k !== "attr")) return undefined;
  return { k: "call", ...runs(first.value, rest, st), pos };
}
