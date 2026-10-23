import { valueChain } from "./chain.js";
import type { Scoped, SetterRules } from "./language.js";
import { children, dottedPath, type Arg, type CallExpr, type Entry, type Expr, type FunctionDef } from "./model.js";
import { lookup } from "./project.js";
import { appliedSteps } from "./applied.js";
import { evaluate } from "./evaluate.js";
import { staticText } from "../../resolve/parts.js";
import { mayNotRun } from "./edits.js";
import { scopedIn } from "./fluent.js";
import type { IrCtx } from "./raw.js";

/**
 * JVM SDKs take parameters as builders: `MessageCreateParams.builder().model(m).maxTokens(1024).build()`, also built
 * in steps on a variable, or filled by a lambda (`s3.getObject { it.bucket(b).key(k) }`). Read as the dict of the
 * fields they set, the rest of the engine (shapes, path parameters, the model) reads them like any dict literal.
 */

const STARTS = new Set(["builder", "newBuilder"]);
/** Copies followed (`a.toBuilder()...build()` of a value itself copied). */
const MAX_COPIES = 4;
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
/** Calls on a builder that set no field (`builder.toString()` between two steps). */
const NOT_SETTERS = new Set(["build", "toString", "equals", "hashCode", "validate", "toBuilder"]);

interface Setter {
  name: string;
  args: Arg[];
  /** Called in a branch or a loop body before `build()`: the field may not be sent. */
  optional?: boolean;
  /** Where it is written: orders the setters of a lambda read from its calls and its property assignments. */
  offset?: number;
}

/** Bare calls with a lambda that run code rather than fill a nested builder (`run { ... }`, `repeat(3) { ... }`). */
const SCOPE_FUNCTIONS = new Set(["run", "with", "apply", "also", "let", "repeat", "require", "check", "lazy", "launch", "async", "runBlocking", "runCatching", "buildString", "buildList", "buildMap", "coroutineScope", "supervisorScope", "withContext"]);

/** `X.builder()` (or `X.builder(name)`, see `startSetters`): the class `X` it builds, else undefined. */
const startOf = (e: Expr): Expr | undefined => (e.k === "call" && e.fn.k === "attr" && STARTS.has(e.fn.name) ? e.fn.obj : undefined);

/** Kotlin `apply { model(m) }` / `also { it.model(m) }` on a builder: the lambda's calls on it, read in the lambda. */
function appliedSetters(call: CallExpr): Setter[] {
  return appliedSteps(call.applied).flatMap(({ call: c, fn }) => {
    const name = c.fn.k === "name" || c.fn.k === "attr" ? c.fn.name : undefined;
    return name ? [{ name, args: c.args.map((a) => ({ ...a, value: { k: "scoped", expr: a.value, fn } })) }] : [];
  });
}

/** `x.a(1).b(2)`: the receiver at its root (`x`) and the setters called on it, in order, with those of `apply { }`. */
function setterChain(e: Expr): { root: Expr; setters: Setter[] } {
  const setters: Setter[] = [];
  let cur = e;
  // a method of the class (`this.base()`) is where the chain starts, not a setter
  while (cur.k === "call" && cur.fn.k === "attr" && cur.fn.obj.k !== "this" && !startOf(cur)) {
    setters.unshift({ name: cur.fn.name, args: cur.args }, ...appliedSetters(cur));
    cur = cur.fn.obj;
  }
  if (cur.k === "call") setters.unshift(...appliedSetters(cur));
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
  // a setter written in an `apply { }` lambda: its argument is read there
  if (e.k === "scoped") return constant(e.expr, e.fn, ctx, rules);
  if ((e.k !== "attr" && e.k !== "name") || !/^[A-Z]/.test(e.name)) return undefined;
  const path = externalPath(e, fn, ctx);
  if (!path || path.length < 2 || !inPackages(path, rules)) return undefined;
  const named = own(rules.constants, path[path.length - 2]!);
  const style = named ?? own(rules.constants, "*");
  // `ChatRole.User`: only for a class the rules name, an upper-case constant for any
  if (!style || (!CONSTANT.test(e.name) && style !== "lower") || (style === "lower" && !named)) return undefined;
  let v = path[path.length - 1]!.toLowerCase();
  if (style === "kebab") v = v.replace(/_/g, "-");
  for (const [pattern, replacement] of rules.constantRewrites ?? []) v = v.replace(new RegExp(pattern), replacement);
  return { k: "str", v };
}

/** An SDK enum constant read outside a builder (`ChatModel.GPT_4O_MINI`, Spring AI's `.model(...asString())`): its string. */
export function sdkConstant(e: Expr, fn: FunctionDef, ctx: IrCtx): Expr | undefined {
  const path = e.k === "attr" || e.k === "name" ? externalPath(e, fn, ctx) : undefined;
  const rules = path ? ctx.idx.lang.registry.find((r) => r.setters?.constants && inPackages(path, r.setters))?.setters : undefined;
  return rules ? constant(e, fn, ctx, rules) : undefined;
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
  /** `item`: one item of a list, or one key of a map with a second argument (Lombok `@Singular`). */
  kind: "set" | "add" | "addAll" | "put" | "putAll" | "item";
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
  const item = own(rules.items, name);
  if (item !== undefined) return { field: item, kind: "item" };
  const mapped = own(rules.fields, name);
  if (mapped === "") return undefined;
  const [field, role] = mapped?.split(":") ?? [];
  if (role) return { field: field!, kind: "add", role };
  const list = kind === "add" || kind === "addAll";
  return { field: field ?? cased(list ? plural(base) : base, rules), kind: kind === "addAll" ? "set" : kind };
}

const str = (v: string): Expr => ({ k: "str", v });

/** `applyMutation(b -> b.key(k))` (AWS SDK for Java 2.x): the lambda's setters are the builder's own. */
function mutated(setters: Setter[], fn: FunctionDef, rules: SetterRules): Setter[] {
  return setters.flatMap((s) => {
    const a = s.name === "applyMutation" && s.args.length === 1 ? s.args[0]!.value : undefined;
    return a?.k === "fnref" && a.fn.params.length === 1 ? settersIn(lambdaSetters(a.fn, rules), a.fn, fn) : [s];
  });
}

/** `set(Columns.DONE, true)`: a key named by a constant (also of a nested `object`) is its text. */
function putKey(a: Expr, fn: FunctionDef, ctx: IrCtx): Expr {
  if (a.k === "str") return a;
  const text = staticText(evaluate(a, fn, ctx));
  return text !== undefined ? { k: "str", v: text } : a;
}

/** The setters as a dict: one entry per field, list fields gathering their `add` items, map fields their `put` keys. */
function dictOf(setters: Setter[], fn: FunctionDef, ctx: IrCtx, rules: SetterRules): Expr {
  const entries: Entry[] = [];
  const byField = new Map<string, Entry>();
  const always = new Set<string>();
  for (const s of mutated(setters, fn, rules)) {
    const [a, b] = s.args.filter((x) => !x.name && !x.spread).map((x) => x.value);
    // `set("name", v)` in supabase-kt's `update({ ... })`: a key of the value itself
    if (rules.putters?.includes(s.name) && a && b) {
      const key = putKey(a, fn, ctx);
      entries.push({ key, value: b });
      if (!s.optional && key.k === "str") always.add(key.v);
      continue;
    }
    const named = NOT_SETTERS.has(s.name) ? undefined : fieldOf(s.name, rules);
    const f = named?.kind === "item" ? { ...named, kind: b ? ("put" as const) : ("add" as const) } : named;
    if (!f || !a) continue;
    if (!s.optional) always.add(f.field);
    // a nested request filled by a lambda (`inferenceConfig(c -> c.maxTokens(512))`, `inferenceConfig { maxTokens = 512 }`)
    const value = constant(a, fn, ctx, rules) ?? nestedLambda(a, ctx, rules) ?? a;
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
  // a field set only in a branch (`if (stream) b.stream(true)`) may not be sent
  return { k: "dict", entries: entries.map((en) => (en.key?.k === "str" && !always.has(en.key.v) ? { ...en, optional: true } : en)) };
}

/** Calls in `fn` between `from` and `to` whose receiver chain starts at the variable `name`: steps of a builder. */
function steps(fn: FunctionDef, name: string, from: number, to: number): Setter[] {
  const out: Setter[] = [];
  for (const c of fn.calls) {
    if (c.pos.offset <= from || c.pos.offset >= to || c.fn.k !== "attr") continue;
    const { root } = setterChain(c.fn.obj);
    if (root.k !== "name" || root.name !== name) continue;
    // `b.apply { model(m) }` on the variable stands for the lambda's calls
    const own = c.applied && (c.fn.name === "apply" || c.fn.name === "also") ? [] : [{ name: c.fn.name, args: c.args }];
    const optional = mayNotRun(fn, c.pos.offset, Number.isFinite(to) ? to : undefined);
    out.push(...[...own, ...appliedSetters(c)].map((s) => ({ ...s, offset: c.pos.offset, ...(optional ? { optional } : {}) })));
  }
  return out;
}

/** Calls inside another call's arguments or a property's value (`listOf(Message { ... })`): not steps of the lambda. */
function innerCalls(lambda: FunctionDef): Set<Expr> {
  const inner = new Set<Expr>();
  const walk = (e: Expr, top: boolean): void => {
    if (e.k === "call" && !top) inner.add(e);
    if (e.k !== "fnref" && e.k !== "scoped") children(e).forEach((c) => walk(c, false));
  };
  for (const c of lambda.calls) c.args.forEach((a) => walk(a.value, false));
  for (const p of lambda.props ?? []) walk(p.value, false);
  return inner;
}

/**
 * What a lambda filling a builder sets, in order: calls on its parameter (`{ it.bucket(b) }`), and in Kotlin the
 * properties it assigns on its receiver (`{ bucket = b }`) and the nested builders it fills (`{ inferenceConfig { ... } }`).
 */
function lambdaSetters(lambda: FunctionDef, rules: SetterRules): Setter[] {
  const param = lambda.params.length === 1 ? lambda.params[0]!.name : undefined;
  const out = param ? steps(lambda, param, -1, Number.POSITIVE_INFINITY) : [];
  const inner = lambda.calls.some((c) => c.fn.k === "name") ? innerCalls(lambda) : new Set<Expr>();
  for (const c of lambda.calls) {
    const name = c.fn.k === "name" ? c.fn.name : "";
    const nested = /^[a-z]/.test(name) && !SCOPE_FUNCTIONS.has(name) && c.args.length === 1 && c.args[0]!.value.k === "fnref";
    const put = !!rules.putters?.includes(name) && c.args.length === 2;
    if ((nested || put) && !inner.has(c)) out.push({ name, args: c.args, offset: c.pos.offset, ...(put && mayNotRun(lambda, c.pos.offset, undefined) ? { optional: true } : {}) });
  }
  if (rules.putters) out.push(...closurePuts(lambda, rules.putters));
  for (const p of lambda.props ?? []) out.push({ name: p.name, args: [{ value: p.value }], offset: p.offset });
  return out.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
}

/** Keys put in lambdas nested in a filling lambda (`text?.let { set("text", it) }`): they may not run. */
function closurePuts(lambda: FunctionDef, putters: string[]): Setter[] {
  const out: Setter[] = [];
  const inner = lambda.module.allFunctions.filter((f) => f.parent === lambda);
  for (const f of inner) {
    for (const c of f.calls) {
      const name = c.fn.k === "name" ? c.fn.name : "";
      const value = c.args[1]?.value;
      if (putters.includes(name) && c.args.length === 2 && value) out.push({ name, args: [c.args[0]!, { value: scopedIn(value, f, lambda) }], offset: c.pos.offset, optional: true });
    }
  }
  return out;
}

/** A lambda given to a setter: the dict of the nested builder it fills, read in the lambda's scope. */
function nestedLambda(e: Expr, ctx: IrCtx, rules: SetterRules): Expr | undefined {
  if (e.k !== "fnref" || e.fn.params.length > 1) return undefined;
  const setters = lambdaSetters(e.fn, rules);
  return setters.length > 0 ? { k: "scoped", expr: dictOf(setters, e.fn, ctx, rules), fn: e.fn } : undefined;
}

/** Setters written in `from`, read in `into`. */
const settersIn = (setters: Setter[], from: FunctionDef, into: FunctionDef): Setter[] =>
  from === into ? setters : setters.map((s) => ({ ...s, args: s.args.map((a) => ({ ...a, value: scopedIn(a.value, from, into) })) }));

interface Builder {
  rules: SetterRules;
  setters: Setter[];
}

/** The setter rules of a built value and its setters, in order (those of the value it was copied from first). */
function built(call: CallExpr, fn: FunctionDef, ctx: IrCtx, project: ProjectBuilders | undefined, depth: number): Builder | undefined {
  if (call.fn.k !== "attr" || call.fn.name !== "build" || call.args.length > 0 || depth > MAX_COPIES) return undefined;
  const { root, setters } = setterChain(call.fn.obj);
  const b = root.k === "name" && setters[0]?.name === "toBuilder" ? lookup(root.name, fn, root.pos.offset, ctx.idx) : undefined;
  // `base.toBuilder().a(1).build()` (Lombok `toBuilder = true`): what `base` was built with, then the new setters
  if (b?.kind === "value") {
    const base = b.assign.value.k === "call" ? built(b.assign.value, b.fn, ctx, project, depth + 1) : undefined;
    return base ? { rules: base.rules, setters: [...settersIn(base.setters, b.fn, fn), ...setters] } : undefined;
  }
  return builderOf(call.fn.obj, fn, ctx, { project, depth, at: call.pos.offset });
}

interface Reading {
  project: ProjectBuilders | undefined;
  depth: number;
  /** Where the builder is used: steps on a variable holding it count until there. */
  at: number;
}

/**
 * A builder before its `build()`: `X.builder().a(1)`, a variable of the function holding one with the steps made on
 * it (also by project functions it is given to: `defaults(b)`), or a project function returning one (`base().a(1)`).
 */
function builderOf(e: Expr, fn: FunctionDef, ctx: IrCtx, r: Reading): Builder | undefined {
  const { root, setters } = setterChain(e);
  const cls = startOf(root);
  if (cls) {
    const rules = rulesFor(cls, fn, ctx, r.project);
    const first = rules ? startSetters(root as CallExpr, cls, rules) : undefined;
    return rules && first ? { rules, setters: [...first, ...setters] } : undefined;
  }
  if (r.depth > MAX_COPIES) return undefined;
  const next = { ...r, depth: r.depth + 1 };
  if (root.k === "call") {
    const made = factoryBuilder(root, fn, ctx, next);
    return made ? { rules: made.rules, setters: [...made.setters, ...setters] } : undefined;
  }
  if (root.k !== "name") return undefined;
  const b = lookup(root.name, fn, root.pos.offset, ctx.idx);
  if (b.kind !== "value" || b.fn !== fn) return undefined;
  const start = builderOf(b.assign.value, fn, ctx, { ...next, at: b.assign.offset });
  if (!start) return undefined;
  const filled = [...steps(fn, root.name, b.assign.offset, r.at), ...helperSteps(fn, root.name, b.assign.offset, r.at, ctx)];
  return { rules: start.rules, setters: [...start.setters, ...filled.sort((x, y) => (x.offset ?? 0) - (y.offset ?? 0)), ...setters] };
}

/** `CallToolRequest.builder(name)`: the fields its arguments set (`setters.positional`); none for `builder()`. */
function startSetters(start: CallExpr, cls: Expr, rules: SetterRules): Setter[] | undefined {
  if (start.args.length === 0) return [];
  const fields = own(rules.positional, cls.k === "attr" || cls.k === "name" ? cls.name : "");
  if (!fields || start.args.some((a) => a.name || a.spread)) return undefined;
  return start.args.slice(0, fields.length).map((a, i) => ({ name: fields[i]!, args: [a] }));
}

/** `base()` returning `X.builder().model(m)`: the builder its first return makes, read in the caller. */
function factoryBuilder(call: CallExpr, fn: FunctionDef, ctx: IrCtx, r: Reading): Builder | undefined {
  // a function of the class or the file (`base()`, `this.base()`); library calls (`Request.Builder()`) are not looked up
  const own = call.fn.k === "name" || (call.fn.k === "attr" && call.fn.obj.k === "this");
  if (!own || call.args.length > 0) return undefined;
  const c = valueChain(call.fn, fn, ctx);
  if (c.root.kind !== "function" || c.segs.length > 0) return undefined;
  const target = c.root.fn;
  for (const ret of target.returns) {
    const made = builderOf(ret, target, ctx, { ...r, at: Number.POSITIVE_INFINITY });
    if (made) return { rules: made.rules, setters: settersIn(made.setters, target, fn) };
  }
  return undefined;
}

/** `defaults(b)` between `from` and `to`: the steps the project function makes on the parameter it gets `b` as. */
function helperSteps(fn: FunctionDef, name: string, from: number, to: number, ctx: IrCtx): Setter[] {
  const out: Setter[] = [];
  for (const c of fn.calls) {
    const i = c.args.findIndex((a) => !a.name && !a.spread && a.value.k === "name" && a.value.name === name);
    if (c.pos.offset <= from || c.pos.offset >= to || i < 0) continue;
    const chain = valueChain(c.fn, fn, ctx);
    const target = chain.root.kind === "function" && chain.segs.length === 0 ? chain.root.fn : undefined;
    const param = target?.params[i];
    if (!target || !param || target === fn) continue;
    const optional = mayNotRun(fn, c.pos.offset, Number.isFinite(to) ? to : undefined);
    const own = settersIn(steps(target, param.name, -1, Number.POSITIVE_INFINITY), target, fn);
    out.push(...own.map((s) => ({ ...s, offset: c.pos.offset, ...(optional || s.optional ? { optional: true } : {}) })));
  }
  return out;
}

/**
 * `X.builder() ... .build()`, or a variable holding `X.builder() ...` with steps before `.build()`, for a class of an SDK
 * with setter rules or a project class `project` gives rules for; also a copy made with `toBuilder()`.
 */
export function builderValue(call: CallExpr, fn: FunctionDef, ctx: IrCtx, project?: ProjectBuilders): Scoped | undefined {
  const b = built(call, fn, ctx, project, 0);
  return b ? { expr: dictOf(b.setters, fn, ctx, b.rules), fn } : dslValue(call, fn, ctx);
}

/** The setter rules of an SDK class written in the code (`ChatCompletionRequest`, `com.x.model.Foo`), if any. */
export function sdkRules(cls: Expr, fn: FunctionDef, ctx: IrCtx): SetterRules | undefined {
  return rulesFor(cls, fn, ctx);
}

/** Fields given one by one (named constructor arguments), read with the SDK's setter rules. */
export const fieldsDict = (fields: { name: string; value: Expr }[], fn: FunctionDef, ctx: IrCtx, rules: SetterRules): Expr =>
  dictOf(
    fields.map((f) => ({ name: f.name, args: [{ value: f.value }] })),
    fn,
    ctx,
    rules,
  );

/** `PutObjectRequest { bucket = b }` (AWS SDK for Kotlin): a class of an SDK's parameter packages built by a lambda. */
function dslValue(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const lambda = call.args.length === 1 && !call.args[0]!.name ? call.args[0]!.value : undefined;
  const name = call.fn.k === "name" || call.fn.k === "attr" ? call.fn.name : "";
  // a lambda that assigns nothing (`Column { ... }` in Compose) fills no request: its class is not looked up
  if (lambda?.k !== "fnref" || !lambda.fn.props?.length || !/^[A-Z]/.test(name)) return undefined;
  const rules = rulesFor(call.fn, fn, ctx);
  return rules ? lambdaValue({ expr: lambda, fn }, rules, ctx) : undefined;
}

/** A lambda that fills a builder (`{ it.bucket(b).key(k) }`, `{ req -> req.channel(c) }`): the dict of what it sets. */
export function lambdaValue(s: Scoped, rules: SetterRules, ctx: IrCtx): Scoped | undefined {
  if (s.expr.k !== "fnref") return undefined;
  const lambda = s.expr.fn;
  if (lambda.params.length !== 1) return undefined;
  const setters = lambdaSetters(lambda, rules);
  // a lambda putting no key the scan reads (keys set in a loop, by a helper) is not an empty body
  if (rules.putters && setters.length === 0) return undefined;
  return { expr: dictOf(setters, lambda, ctx, rules), fn: lambda };
}
