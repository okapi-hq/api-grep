import { calleeChain } from "../../ir/chain.js";
import type { IrInjection, Scoped } from "../../ir/language.js";
import { argFor, type CallExpr, type ClassDef, type Expr, type FunctionDef, type Param } from "../../ir/model.js";
import { namedCalls } from "../../ir/param-values.js";
import { lookup } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { diIndex, koinQualifiers, managedBy, names, PROVIDES, qualifiers, type Framework, type Provider } from "./providers.js";
import { sameType, typeKey } from "./types.js";

/**
 * Values a DI container gives (#46): a parameter of a provider or of a constructor the container calls, a field it
 * injects, a Koin lookup (`get()`, `by inject()`). The value is the one provider of the declared type that the
 * qualifiers select; several, or none, leave it unknown rather than guessed.
 */

/** Where a value is injected: by which container, with which qualifiers, under which name (Spring's fallback). */
interface Point {
  framework: Framework;
  quals: string[];
  name?: string;
}

/** The one provider an injection point gets: its container's, by qualifiers, then Spring's `@Primary` and bean name. */
function pick(cands: Provider[], at: Point): Provider | undefined {
  const spring = at.framework === "spring";
  const own = cands.filter((c) => c.framework === at.framework);
  let m = at.quals.length > 0 ? own.filter((c) => at.quals.every((q) => c.quals.includes(q) || (spring && q === `named:${c.name}`))) : own.filter((c) => c.quals.length === 0 || spring);
  if (m.length > 1 && at.quals.length === 0 && spring) {
    const primary = m.filter((c) => c.primary);
    const named = m.filter((c) => c.name === at.name);
    m = primary.length === 1 ? primary : named.length === 1 ? named : m;
  }
  return m.length === 1 ? m[0] : undefined;
}

/** The value of the provider of `type` (as declared in `fn`) the injection point gets; never one of `fn`'s own. */
export function provided(type: Expr | undefined, at: Point, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const key = type ? typeKey(type, fn, ctx) : undefined;
  if (!key) return undefined;
  const cands = (diIndex(ctx).byName.get(key.simple.split(".").pop()!) ?? []).filter((p) => p.fn !== fn && sameType(p.key, key));
  return pick(cands, at)?.value;
}

/** `get()`, `get(named("x"))`, `inject()`: a Koin lookup written as an argument. */
const koinGet = (e: Expr): e is CallExpr => e.k === "call" && e.fn.k === "name" && (e.fn.name === "get" || e.fn.name === "inject");

/** The container giving a function's parameters: a provider's, an `@Inject` / `@Autowired` method's, a managed constructor's. */
function injecting(fn: FunctionDef): Framework | undefined {
  const anns = names(fn.annotations);
  if (anns.has("Bean") || anns.has("Autowired")) return "spring";
  if (anns.has("Provides") || anns.has("Produces") || anns.has("Binds")) return "jsr330";
  if (fn.name === "<init>" && fn.cls) return managedBy(fn.cls);
  return anns.has("Inject") ? (fn.cls && managedBy(fn.cls) === "spring" ? "spring" : "jsr330") : undefined;
}

/** A provider or Koin definition: the constructor calls in it are the container's. */
const providing = (fn: FunctionDef, ctx: IrCtx): boolean => diIndex(ctx).koinLambdas.has(fn) || [...names(fn.annotations)].some((n) => PROVIDES.has(n));

/**
 * A constructor parameter of a class the project builds in providers only: `single { Repo(get()) }` (a lookup of the
 * parameter's type), `singleOf(::Repo)`, `@Provides fun repo(client: OkHttpClient) = Repo(client)` (the argument,
 * read in the provider). A class also built elsewhere, or built twice with different arguments, is not followed.
 */
function constructorArg(p: Param, init: FunctionDef, cls: ClassDef, ctx: IrCtx): Scoped | undefined {
  const sites = (namedCalls(ctx.idx).get(cls.name) ?? []).filter((s) => {
    const c = calleeChain(s.call, s.fn, ctx);
    return c.segs.length === 0 && c.root.kind === "class" && c.root.cls === cls;
  });
  const values: Scoped[] = [];
  const lookups: string[][] = diIndex(ctx).koinBuilt.has(cls) ? [[]] : [];
  for (const s of sites) {
    const arg = argFor(s.call, p);
    if (!arg) return undefined;
    if (koinGet(arg.value)) lookups.push(koinQualifiers(arg.value, s.fn, ctx));
    else if (providing(s.fn, ctx)) values.push({ expr: arg.value, fn: s.fn });
    else return undefined;
  }
  if (values.length === 1 && lookups.length === 0) return values[0];
  const quals = lookups[0];
  if (values.length > 0 || !quals || lookups.some((q) => q.join() !== quals.join())) return undefined;
  return provided(p.type, { framework: "koin", quals }, init, ctx);
}

const params = new WeakMap<Param, Scoped | null>();

function injectedParam(p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  // `@Value("${billing.url:https://...}") String url` of a bean method: the configuration value, not a parameter
  if (p.default && names(p.annotations).has("Value") && injecting(fn)) return { expr: p.default, fn };
  if (p.kind !== "normal" || p.default || !p.type) return undefined;
  const hit = params.get(p);
  if (hit !== undefined) return hit ?? undefined;
  // set before reading: a provider reading its own type's parameter must not loop
  params.set(p, null);
  let v: Scoped | undefined;
  const framework = injecting(fn);
  if (names(p.annotations).has("Assisted")) v = undefined;
  else if (framework) v = provided(p.type, { framework, quals: qualifiers(p.annotations, fn, ctx), name: p.name }, fn, ctx);
  else if (fn.name === "<init>" && fn.cls) v = constructorArg(p, fn, fn.cls, ctx);
  params.set(p, v ?? null);
  return v;
}

/** `@Inject lateinit var client: OkHttpClient`, `@Autowired private RestTemplate rest;`. */
function injectedField(cls: ClassDef, name: string, ctx: IrCtx): Scoped | undefined {
  const anns = names(cls.fieldAnnotations?.get(name));
  const framework: Framework | undefined = anns.has("Autowired") || anns.has("Resource") ? "spring" : anns.has("Inject") ? (managedBy(cls) === "spring" ? "spring" : "jsr330") : undefined;
  if (!framework) return undefined;
  const scope = cls.methods.get("<init>") ?? cls.module.top;
  return provided(cls.fieldTypes.get(name), { framework, quals: qualifiers(cls.fieldAnnotations?.get(name), scope, ctx), name }, scope, ctx);
}

/** `get<HttpClient>()`, `inject<Api>(named("x"))`, `val client: HttpClient by inject()` (typed when lowered). */
function injectedCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (!koinGet(call) || !call.typeArgs?.[0] || call.fn.k !== "name") return undefined;
  if (lookup(call.fn.name, fn, call.pos.offset, ctx.idx).kind === "function") return undefined;
  return provided(call.typeArgs[0], { framework: "koin", quals: koinQualifiers(call, fn, ctx) }, fn, ctx);
}

export const JVM_INJECTION: IrInjection = { param: injectedParam, field: injectedField, call: injectedCall };
