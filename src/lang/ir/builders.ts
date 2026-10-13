import { valueChain } from "./chain.js";
import type { Scoped, SetterRules } from "./language.js";
import { dottedPath, type Arg, type CallExpr, type Entry, type Expr, type FunctionDef } from "./model.js";
import { lookup } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * JVM SDKs take parameters as builders: `MessageCreateParams.builder().model(m).maxTokens(1024).build()`, also built
 * in steps on a variable, or filled by a lambda (`s3.getObject { it.bucket(b).key(k) }`). Read as the dict of the
 * fields they set, the rest of the engine (shapes, path parameters, the model) reads them like any dict literal.
 */

const STARTS = new Set(["builder", "newBuilder"]);
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
/** Calls on a builder that set no field (`builder.toString()` between two steps). */
const NOT_SETTERS = new Set(["build", "toString", "equals", "hashCode", "validate", "toBuilder"]);

interface Setter {
  name: string;
  args: Arg[];
}

/** `X.builder()`: the class `X` it builds, else undefined. */
const startOf = (e: Expr): Expr | undefined => (e.k === "call" && e.fn.k === "attr" && STARTS.has(e.fn.name) && e.args.length === 0 ? e.fn.obj : undefined);

/** `x.a(1).b(2)`: the receiver at its root (`x`) and the setters called on it, in order. */
function setterChain(e: Expr): { root: Expr; setters: Setter[] } {
  const setters: Setter[] = [];
  let cur = e;
  while (cur.k === "call" && cur.fn.k === "attr" && !startOf(cur)) {
    setters.unshift({ name: cur.fn.name, args: cur.args });
    cur = cur.fn.obj;
  }
  return { root: cur, setters };
}

/** A dotted class or constant path of an SDK (`com.anthropic.models.messages.Model.CLAUDE_SONNET_4_5`). */
function externalPath(e: Expr, fn: FunctionDef, ctx: IrCtx): string[] | undefined {
  const c = valueChain(e, fn, ctx);
  if (c.root.kind === "external" && c.segs.length > 0 && c.segs.every((s) => !s.call && !s.typed)) return c.segs.map((s) => s.name);
  // written fully qualified (`com.anthropic.models.messages.Model.X`): a package path no import names
  const path = c.root.kind === "global" || c.root.kind === "unknown" ? dottedPath(e) : undefined;
  return path && path.length > 2 && /^[a-z]/.test(path[0]!) ? path : undefined;
}

/** A key of a registry table, never one of `Object.prototype` (`toString`, `constructor`): names come from the code. */
const own = <T>(table: Record<string, T> | undefined, key: string): T | undefined => (table && Object.hasOwn(table, key) ? table[key] : undefined);

const inPackages = (path: string[], rules: SetterRules): boolean => rules.packages.some((p) => path.join(".").startsWith(`${p}.`));

/** The setter rules of a project class built with `X.builder()` (Lombok `@Builder`), when the language knows them. */
export type ProjectBuilders = (cls: Expr, fn: FunctionDef, ctx: IrCtx) => SetterRules | undefined;

function rulesFor(cls: Expr, fn: FunctionDef, ctx: IrCtx, project?: ProjectBuilders): SetterRules | undefined {
  const path = externalPath(cls, fn, ctx);
  return path ? ctx.idx.lang.registry.find((r) => r.setters && inPackages(path, r.setters))?.setters : project?.(cls, fn, ctx);
}

/** `Model.CLAUDE_SONNET_4_5` -> `"claude-sonnet-4-5"`, `ChatModel.GPT_4_1` -> `"gpt-4.1"`, for the enum classes the rules name. */
function constant(e: Expr, fn: FunctionDef, ctx: IrCtx, rules: SetterRules): Expr | undefined {
  if ((e.k !== "attr" && e.k !== "name") || !CONSTANT.test(e.name)) return undefined;
  const path = externalPath(e, fn, ctx);
  if (!path || path.length < 2 || !inPackages(path, rules)) return undefined;
  const style = own(rules.constants, path[path.length - 2]!) ?? own(rules.constants, "*");
  if (!style) return undefined;
  let v = path[path.length - 1]!.toLowerCase();
  if (style === "kebab") v = v.replace(/_/g, "-");
  for (const [pattern, replacement] of rules.constantRewrites ?? []) v = v.replace(new RegExp(pattern), replacement);
  return { k: "str", v };
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

function plural(s: string): string {
  if (/(?:s|x|ch|sh)$/.test(s)) return `${s}es`;
  return /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`;
}

function cased(name: string, rules: SetterRules): string {
  if (rules.case === "pascal") return name.charAt(0).toUpperCase() + name.slice(1);
  return rules.case === "snake" ? name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) : name;
}

interface Field {
  field: string;
  kind: "set" | "add" | "addAll" | "put" | "putAll";
  role?: string;
}

/** The field a setter sets: `maxTokens` -> `max_tokens`, `setEmail` -> `email`, `addTool` -> `tools`, `putMetadata` -> `metadata`. */
function fieldOf(name: string, rules: SetterRules): Field | undefined {
  const prefix = (rules.prefixes ?? []).find((p) => name.length > p.length && name.startsWith(p) && /[A-Z]/.test(name.charAt(p.length)));
  let base = prefix ? lowerFirst(name.slice(prefix.length)) : name;
  let kind: Field["kind"] = prefix === "add" ? "add" : prefix === "put" ? "put" : "set";
  // `addAllLineItem(items)` sets the whole list, `putAllMetadata(map)` adds every key
  if ((kind === "put" || kind === "add") && /^all[A-Z]/.test(base)) {
    base = lowerFirst(base.slice(3));
    kind = kind === "put" ? "putAll" : "addAll";
  }
  const mapped = own(rules.fields, name);
  if (mapped === "") return undefined;
  const [field, role] = mapped?.split(":") ?? [];
  if (role) return { field: field!, kind: "add", role };
  const list = kind === "add" || kind === "addAll";
  return { field: field ?? cased(list ? plural(base) : base, rules), kind: kind === "addAll" ? "set" : kind };
}

const str = (v: string): Expr => ({ k: "str", v });

/** The setters as a dict: one entry per field, list fields gathering their `add` items, map fields their `put` keys. */
function dictOf(setters: Setter[], fn: FunctionDef, ctx: IrCtx, rules: SetterRules): Expr {
  const entries: Entry[] = [];
  const byField = new Map<string, Entry>();
  for (const s of setters) {
    const f = NOT_SETTERS.has(s.name) ? undefined : fieldOf(s.name, rules);
    const [a, b] = s.args.filter((x) => !x.name && !x.spread).map((x) => x.value);
    if (!f || !a) continue;
    const value = constant(a, fn, ctx, rules) ?? a;
    let entry = byField.get(f.field);
    if (f.kind === "set" || !entry) {
      entry = { key: str(f.field), value: f.kind === "add" ? { k: "list", items: [] } : f.kind === "set" ? value : { k: "dict", entries: [] } };
      if (byField.has(f.field)) entries.splice(entries.indexOf(byField.get(f.field)!), 1);
      byField.set(f.field, entry);
      entries.push(entry);
    }
    if (f.kind === "add" && entry.value.k === "list") entry.value.items.push(f.role ? { k: "dict", entries: [{ key: str("role"), value: str(f.role) }, { key: str("content"), value }] } : value);
    else if (f.kind === "put" && b && entry.value.k === "dict") entry.value.entries.push({ key: a, value: constant(b, fn, ctx, rules) ?? b });
    else if (f.kind === "putAll" && entry.value.k === "dict") entry.value.entries.push({ value, spread: true });
  }
  return { k: "dict", entries };
}

/** Calls in `fn` between `from` and `to` whose receiver chain starts at the variable `name`: steps of a builder. */
function steps(fn: FunctionDef, name: string, from: number, to: number): Setter[] {
  const out: Setter[] = [];
  for (const c of fn.calls) {
    if (c.pos.offset <= from || c.pos.offset >= to || c.fn.k !== "attr") continue;
    const { root } = setterChain(c.fn.obj);
    if (root.k === "name" && root.name === name) out.push({ name: c.fn.name, args: c.args });
  }
  return out;
}

/**
 * `X.builder() ... .build()`, or a variable holding `X.builder() ...` with steps before `.build()`, for a class of an SDK
 * with setter rules or a project class `project` gives rules for.
 */
export function builderValue(call: CallExpr, fn: FunctionDef, ctx: IrCtx, project?: ProjectBuilders): Scoped | undefined {
  if (call.fn.k !== "attr" || call.fn.name !== "build" || call.args.length > 0) return undefined;
  const { root, setters } = setterChain(call.fn.obj);
  const cls = startOf(root);
  if (cls) {
    const rules = rulesFor(cls, fn, ctx, project);
    return rules ? { expr: dictOf(setters, fn, ctx, rules), fn } : undefined;
  }
  if (root.k !== "name") return undefined;
  const b = lookup(root.name, fn, root.pos.offset, ctx.idx);
  if (b.kind !== "value" || b.fn !== fn) return undefined;
  const start = setterChain(b.assign.value);
  const varCls = startOf(start.root);
  const rules = varCls ? rulesFor(varCls, fn, ctx, project) : undefined;
  if (!rules) return undefined;
  const all = [...start.setters, ...steps(fn, root.name, b.assign.offset, call.pos.offset), ...setters];
  return { expr: dictOf(all, fn, ctx, rules), fn };
}

/** A lambda that fills a builder (`{ it.bucket(b).key(k) }`, `{ req -> req.channel(c) }`): the dict of what it sets. */
export function lambdaValue(s: Scoped, rules: SetterRules, ctx: IrCtx): Scoped | undefined {
  if (s.expr.k !== "fnref") return undefined;
  const lambda = s.expr.fn;
  const param = lambda.params[0];
  if (!param || lambda.params.length > 1) return undefined;
  return { expr: dictOf(steps(lambda, param.name, -1, Number.POSITIVE_INFINITY), lambda, ctx, rules), fn: lambda };
}
