import { valueChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { Annotation, CallExpr, ClassDef, Expr, FunctionDef, ModuleModel } from "../../ir/model.js";
import type { IrCtx } from "../../ir/raw.js";
import { lambdaOf } from "../../ir/steps.js";
import { staticKey } from "../../ir/values.js";
import { annotationName } from "../annotations.js";
import { injektProvider, koinBound, springAliases } from "./locators.js";
import { generic, providedType, typeKey, type TypeKey } from "./types.js";

/**
 * What a DI container provides, read from the project's declarations: Dagger / Hilt `@Provides` and `@Binds`, Spring
 * `@Bean` methods and stereotype classes, CDI `@Produces`, classes with an `@Inject` constructor, and Koin definitions
 * (`single { ... }`, `factory<T> { ... }`, `singleOf(::Repo)`).
 */

/** One binding: the type it is for, its value read where it is written, and what tells it apart from the others. */
export interface Provider {
  key: TypeKey;
  /** Undefined when it cannot be read (a provider with several `return`s): it still makes a lookup ambiguous. */
  value?: Scoped;
  /** The providing function: its own parameters never get its value. */
  fn?: FunctionDef;
  quals: string[];
  /** Spring: the bean name (the method's, or the stereotype class's decapitalized). */
  name?: string;
  primary?: boolean;
  /** The container: a binding is only ever injected by its own (a Koin backend next to a Dagger app). */
  framework: Framework;
  /**
   * A multibinding contribution (#75): one element (`@IntoSet`), several (`@ElementsIntoSet`), or a whole collection
   * provided as such (`fun interceptors(): Set<Interceptor>`). Only an injected collection gets it.
   */
  bag?: "into" | "elements" | "plain";
}

/**
 * Dagger, Hilt and other JSR-330 containers (`@Provides`, `@Binds`, `@Inject` constructors); Spring (`@Bean`,
 * stereotypes; an injection point without a qualifier sees qualified beans too); Koin (definitions and lookups).
 */
export type Framework = "jsr330" | "spring" | "koin" | "injekt";

/** Collection types a container fills with every binding of their element type (Spring, multibindings). */
export const COLLECTIONS = new Set(["Set", "MutableSet", "List", "MutableList", "Collection", "Iterable"]);

export interface DiIndex {
  /** Providers by the last name of their type (`OkHttpClient`, `Builder`). */
  byName: Map<string, Provider[]>;
  /** Classes Koin constructs itself (`singleOf(::Repo)`): every constructor parameter is a lookup. */
  koinBuilt: Set<ClassDef>;
  /** Koin definition lambdas: the constructor calls in them are DI constructions. */
  koinLambdas: Set<FunctionDef>;
}

export const PROVIDES = new Set(["Provides", "Bean", "Produces"]);
/** Classes a container builds, their constructor's parameters injected: CDI scopes and Hilt view models; Spring stereotypes. */
const MANAGED = new Set(["ApplicationScoped", "RequestScoped", "Dependent", "HiltViewModel"]);
const SPRING = new Set(["Bean", "Component", "Service", "Repository", "Controller", "RestController", "Configuration"]);
const KOIN_DEFS = new Set(["single", "factory", "scoped", "viewModel", "worker"]);
const KOIN_OF = new Set(["singleOf", "factoryOf", "scopedOf", "viewModelOf", "workerOf"]);

export const names = (anns: Annotation[] | undefined): Set<string> => new Set((anns ?? []).flatMap((a) => annotationName(a) ?? []));
const has = (anns: Annotation[] | undefined, set: Set<string>): boolean => [...names(anns)].some((n) => set.has(n));

/** A string argument of an annotation or call (`@Named("x")`, `@Bean(name = "x")`, `named("x")`), by name or first. */
function stringArg(args: { name?: string; value: Expr }[], fn: FunctionDef, ctx: IrCtx, keys: string[]): string | undefined {
  const a = args.find((x) => x.name && keys.includes(x.name)) ?? args.find((x) => !x.name);
  const v = a?.value.k === "list" ? a.value.items[0] : a?.value;
  return v ? staticKey(v, fn, ctx) : undefined;
}

/** `@Named("x")`, Spring `@Qualifier("x")`, an annotation class of the project annotated `@Qualifier`. */
export function qualifiers(anns: Annotation[] | undefined, fn: FunctionDef, ctx: IrCtx): string[] {
  const out: string[] = [];
  for (const a of anns ?? []) {
    const n = annotationName(a);
    if (n === "Named" || (n === "Qualifier" && a.args.length > 0)) {
      const v = stringArg(a.args, fn, ctx, ["value"]);
      if (v !== undefined) out.push(`named:${v}`);
      continue;
    }
    const c = valueChain(a.type, fn, ctx);
    if (c.root.kind === "class" && c.segs.length === 0 && names(c.root.cls.classAnnotations).has("Qualifier")) out.push(`q:${c.root.cls.qname}`);
  }
  return out;
}

/** Koin `named("x")` / `qualifier("x")`, or a type qualifier (`named<Uploads>()`), in a definition's or a lookup's arguments. */
export function koinQualifiers(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string[] {
  const q = call.args.map((a) => a.value).find((v): v is CallExpr => v.k === "call" && v.fn.k === "name" && (v.fn.name === "named" || v.fn.name === "qualifier"));
  const t = q?.typeArgs?.[0] ? typeKey(q.typeArgs[0], fn, ctx) : undefined;
  if (t) return [`type:${t.full ?? t.simple}`];
  const v = q && !q.typeArgs ? stringArg(q.args, fn, ctx, []) : undefined;
  return v !== undefined ? [`named:${v}`] : [];
}

const decapitalize = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** `new Repo()` as the container makes it: a call of the class with no arguments, its parameters injected. */
export function construction(cls: ClassDef): Scoped {
  const fn = cls.methods.get("<init>") ?? cls.module.top;
  return { expr: { k: "call", fn: { k: "qname", path: cls.qname.split("."), pos: fn.pos }, args: [], pos: fn.pos }, fn: cls.module.top };
}

function add(idx: DiIndex, p: Provider): void {
  const last = p.key.simple.split(".").pop()!;
  idx.byName.set(last, [...(idx.byName.get(last) ?? []), p]);
}

/** `@Provides fun okHttp(...): OkHttpClient = ...`, `@Bean RestTemplate rest(...)`, `@Binds fun bind(impl: Impl): Api`. */
function functionProvider(fn: FunctionDef, ctx: IrCtx): Provider | undefined {
  const anns = names(fn.annotations);
  const binds = anns.has("Binds");
  if (!binds && ![...anns].some((n) => PROVIDES.has(n))) return undefined;
  const impl = binds ? fn.params[0]?.type : undefined;
  const value: Scoped | undefined = impl ? { expr: { k: "call", fn: impl, args: [], pos: fn.pos }, fn } : fn.returns.length === 1 ? { expr: fn.returns[0]!, fn } : undefined;
  // `@IntoSet fun auth(): Interceptor`, `@ElementsIntoSet fun all(): Set<Interceptor>`, `fun all(): Set<Interceptor>`
  const declared = generic(fn.returnType);
  const element = declared && COLLECTIONS.has(declared.name) && !anns.has("IntoSet") ? declared.arg : undefined;
  const bag = anns.has("IntoSet") ? "into" : anns.has("ElementsIntoSet") ? "elements" : element ? "plain" : undefined;
  const type = element ?? fn.returnType;
  const key = type ? typeKey(type, fn, ctx) : fn.returns[0] && bag !== "elements" ? providedType(fn.returns[0], fn, ctx) : undefined;
  if (!key) return undefined;
  const bean = (fn.annotations ?? []).find((a) => annotationName(a) === "Bean");
  const name = (bean && stringArg(bean.args, fn, ctx, ["name", "value"])) ?? fn.name;
  const framework: Framework = bean ? "spring" : "jsr330";
  return { key, fn, quals: qualifiers(fn.annotations, fn, ctx), name, framework, ...(value ? { value } : {}), ...(anns.has("Primary") ? { primary: true } : {}), ...(bag ? { bag } : {}) };
}

/** The container that builds a class: Spring for its stereotypes, else JSR-330 (CDI scopes, an `@Inject` constructor). */
export function managedBy(cls: ClassDef): Framework | undefined {
  if (has(cls.classAnnotations, SPRING)) return "spring";
  if (has(cls.classAnnotations, MANAGED)) return "jsr330";
  const ctor = names(cls.methods.get("<init>")?.annotations);
  return ctor.has("Autowired") ? "spring" : ctor.has("Inject") ? "jsr330" : undefined;
}

function classProvider(cls: ClassDef, ctx: IrCtx): Provider | undefined {
  const framework = managedBy(cls);
  if (!framework) return undefined;
  const stereo = (cls.classAnnotations ?? []).find((a) => SPRING.has(annotationName(a) ?? ""));
  const name = (stereo && stringArg(stereo.args, cls.module.top, ctx, ["value"])) ?? decapitalize(cls.name);
  const primary = names(cls.classAnnotations).has("Primary");
  return { key: { full: cls.qname, simple: cls.name }, value: construction(cls), quals: qualifiers(cls.classAnnotations, cls.module.top, ctx), name, framework, ...(primary ? { primary } : {}) };
}

/** `single { HttpClient(CIO) { ... } }`, `single<Api>(named("x")) { ... }`, `singleOf(::Repo)`. */
export function koinProvider(call: CallExpr, fn: FunctionDef, ctx: IrCtx, idx: DiIndex): Provider | undefined {
  const name = call.fn.k === "name" ? call.fn.name : undefined;
  if (name && KOIN_OF.has(name)) {
    const ref = call.args.find((a) => !a.name)?.value;
    const c = ref ? valueChain(ref, fn, ctx) : undefined;
    if (c?.root.kind !== "class" || c.segs.length > 0) return undefined;
    idx.koinBuilt.add(c.root.cls);
    // `singleOf(::Repo) { named("x"); bind<Api>() }`: the qualifier set in the options
    const options = lambdaOf(call);
    const named = options?.calls.find((x) => x.fn.k === "name" && (x.fn.name === "named" || x.fn.name === "qualifier"));
    const quals = options && named ? koinQualifiers({ ...call, args: [{ value: named }] }, options, ctx) : koinQualifiers(call, fn, ctx);
    return { key: { full: c.root.cls.qname, simple: c.root.cls.name }, value: construction(c.root.cls), quals, framework: "koin" };
  }
  const lambda = name && KOIN_DEFS.has(name) ? lambdaOf(call) : undefined;
  if (!lambda) return undefined;
  idx.koinLambdas.add(lambda);
  const ret = lambda.returns.length === 1 ? lambda.returns[0] : undefined;
  const key = call.typeArgs?.[0] ? typeKey(call.typeArgs[0], fn, ctx) : ret ? providedType(ret, lambda, ctx) : undefined;
  return key ? { key, quals: koinQualifiers(call, fn, ctx), framework: "koin", ...(ret ? { value: { expr: ret, fn: lambda } } : {}) } : undefined;
}

const isKoin = (m: ModuleModel): boolean => m.importPaths.some((p) => p[0] === "org" && p[1] === "koin");

const cache = new WeakMap<ModuleModel[], DiIndex>();

/** Every provider of the project, built once per scan. */
export function diIndex(ctx: IrCtx): DiIndex {
  const mods = ctx.idx.all();
  const found = cache.get(mods);
  if (found) return found;
  const idx: DiIndex = { byName: new Map(), koinBuilt: new Set(), koinLambdas: new Set() };
  // set before reading: a provider's type may name a class whose lookup reads the index
  cache.set(mods, idx);
  const base: IrCtx = { idx: ctx.idx };
  for (const m of mods) {
    const koin = isKoin(m);
    const injekt = m.importPaths.some((x) => x[0] === "uy" && x[1] === "kohesive" && x[2] === "injekt");
    for (const fn of m.allFunctions) {
      const p = fn.annotations ? functionProvider(fn, base) : undefined;
      for (const a of p ? [p, ...springAliases(p, base)] : []) add(idx, a);
      for (const call of koin ? fn.calls : []) {
        const k = koinProvider(call, fn, base, idx);
        if (k) add(idx, k);
        for (const b of koinBound(call, fn, base, (c) => koinProvider(c, fn, base, idx))) add(idx, b);
      }
      for (const call of injekt ? fn.calls : []) {
        const k = injektProvider(call, fn, base);
        if (k) add(idx, k);
      }
    }
    for (const cls of m.classes.values()) {
      const p = classProvider(cls, base);
      for (const a of p ? [p, ...springAliases(p, base)] : []) add(idx, a);
    }
  }
  return idx;
}
