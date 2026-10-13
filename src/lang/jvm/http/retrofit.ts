import type { BodyEncoding } from "../../../types.js";
import { valueChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import { dottedPath, type Annotation, type CallExpr, type Entry, type Expr, type FunctionDef, type ModuleModel, type Param } from "../../ir/model.js";
import type { IrCtx, IrPair, IrRaw } from "../../ir/raw.js";
import { annArg, annName, findAnn, headerLines, literal, paramRef } from "./annotations.js";
import { okHttpClientFacts } from "./okhttp.js";
import { buildsFor, type RetrofitBuild } from "./retrofit-link.js";
import { encodingOfType, JVM } from "./tables.js";

const R = JVM.retrofit;
/** The base URL of an interface no `create(...)` links to a builder: a host only known at run time, named `baseUrl`. */
const unknownBase = (m: FunctionDef): Scoped => ({ expr: { k: "attr", obj: { k: "unknown", text: "retrofit" }, name: "baseUrl", pos: m.pos }, fn: m });

interface Verb {
  method: string;
  path?: Expr;
  hasBody: boolean;
}

/** `@GET("users/{id}")`, `@HTTP(method = "DELETE", path = "x", hasBody = true)`: the method, the relative URL, a body allowed. */
function verbOf(m: FunctionDef): Verb | undefined {
  const a = findAnn(m.annotations, Object.keys(R.verbs));
  if (!a) return undefined;
  const verb = R.verbs[annName(a)!];
  if (verb) return { method: verb, path: annArg(a, ["value"]), hasBody: ["POST", "PUT", "PATCH"].includes(verb) };
  const hasBody = annArg(a, ["hasBody"]);
  return { method: literal(annArg(a, ["method"]))?.toUpperCase() ?? "GET", path: annArg(a, ["path"]), hasBody: hasBody?.k === "bool" && hasBody.v };
}

interface Params {
  pairs: IrPair[];
  headers: Scoped[];
  url?: Scoped;
  body?: Scoped;
  bodyType?: Expr;
  query?: Scoped;
  /** `@Field` / `@Part` entries, and the maps of `@FieldMap` / `@PartMap` as spreads. */
  entries: Entry[];
}

/** The name a parameter annotation gives (`@Query("page")`), else none. */
function nameOf(a: Annotation, m: FunctionDef): Scoped | undefined {
  const v = annArg(a, ["value"]);
  return v ? { expr: v, fn: m } : undefined;
}

function readParam(out: Params, p: Param, m: FunctionDef): void {
  const a = findAnn(p.annotations, Object.keys(R.params));
  if (!a) return;
  const value = paramRef(p, m);
  const name = nameOf(a, m);
  switch (R.params[annName(a)!]) {
    case "query":
      if (name) out.pairs.push({ where: "query", name, value });
      break;
    case "header":
      if (name) out.pairs.push({ where: "header", name, value });
      break;
    case "queryMap":
      out.query = value;
      break;
    case "headers":
      out.headers.push(value);
      break;
    case "url":
      out.url = value;
      break;
    case "body":
      [out.body, out.bodyType] = [value, p.type];
      break;
    case "field":
    case "part":
      out.entries.push(name ? { key: name.expr, value: value.expr } : { value: value.expr, spread: true });
      break;
    case "fieldMap":
    case "partMap":
      out.entries.push({ value: value.expr, spread: true });
      break;
    default:
      // `@Path` fills a `{name}` of the relative URL, which stays a placeholder; `@QueryName` has no static name
      break;
  }
}

/**
 * A body's encoding: a form or multipart method, else the `Content-Type` of `@Headers` (it replaces the converter's),
 * else what the first converter able to write the body's type writes. A protobuf converter writes generated messages
 * only: not a class of the project, a generic collection or a scalar, which the next converter writes (#46).
 */
function encodingOf(m: FunctionDef, p: Params, build: RetrofitBuild | undefined, ctx: IrCtx): BodyEncoding | undefined {
  if (findAnn(m.annotations, [R.form])) return "form";
  if (findAnn(m.annotations, [R.multipart])) return "multipart";
  if (!p.body) return undefined;
  const declared = headerLines(findAnn(m.annotations, [R.headers]), m).find((h) => literal(h.name.expr)?.toLowerCase() === "content-type");
  if (declared) return encodingOfType(literal(declared.value?.expr));
  const type = p.bodyType ? dottedPath(p.bodyType.k === "index" ? p.bodyType.obj : p.bodyType)?.join(".") : undefined;
  if (type && R.rawBodies.some((t) => type === t || type.endsWith(`.${t}`))) return "raw";
  const scalar = !!type && R.scalars.includes(type);
  const own = (): boolean => !!p.bodyType && valueChain(p.bodyType, m, ctx).root.kind === "class";
  const message = !!type && !scalar && p.bodyType?.k !== "index" && !own();
  const writer = (build?.converters ?? []).find((c) => (c !== "scalars" || scalar) && (c !== "protobuf" || message));
  return writer === "scalars" ? "raw" : writer === "protobuf" ? "raw" : ((writer as BodyEncoding | undefined) ?? "json");
}

function methodRaw(m: FunctionDef, verb: Verb, build: RetrofitBuild | undefined, ctx: IrCtx): IrRaw {
  const p: Params = { pairs: [], headers: [], entries: [] };
  for (const param of m.params) readParam(p, param, m);
  const encoding = encodingOf(m, p, build, ctx);
  const body = encoding === "form" || encoding === "multipart" ? { expr: { k: "dict", entries: p.entries } as Expr, fn: m } : p.body;
  const call: CallExpr = { k: "call", fn: { k: "name", name: m.name, pos: m.pos }, args: [], pos: m.pos };
  const client = build?.client ? okHttpClientFacts(build.client, ctx) : [];
  return {
    call,
    fn: m,
    client: "retrofit",
    url: p.url ?? (verb.path ? { expr: verb.path, fn: m } : undefined),
    baseUrl: build?.baseUrl ?? unknownBase(m),
    urlJoin: "reference",
    impliedMethod: verb.method,
    body: verb.hasBody || p.body ? body : undefined,
    encoding: body ? encoding : undefined,
    query: p.query,
    headers: p.headers,
    pairs: [...headerLines(findAnn(m.annotations, [R.headers]), m), ...p.pairs, ...client],
    inputs: [],
  };
}

/** A file importing Retrofit's annotations (`retrofit2.http.GET`, `retrofit2.http.*`) declares service interfaces. */
const importsAnnotations = (mod: ModuleModel): boolean => mod.importPaths.some((p) => R.annotations.some((a) => p.join(".") === a || p.join(".").startsWith(`${a}.`)));

/**
 * Retrofit: one request per annotated method of a service interface, at the method, for each base URL the interface
 * is created with (`Retrofit.Builder().baseUrl(...)...create(Api::class.java)`), its client's interceptors applied.
 */
export function detectRetrofit(mod: ModuleModel, ctx: IrCtx): IrRaw[] {
  const out: IrRaw[] = [];
  const declares = importsAnnotations(mod);
  for (const cls of mod.classes.values()) {
    const methods = [...cls.methods.values()].flatMap((m) => {
      const verb = m.name !== "<init>" ? verbOf(m) : undefined;
      return verb ? [{ m, verb }] : [];
    });
    if (methods.length === 0) continue;
    // an interface of a file without Retrofit's annotations (JAX-RS resources share their names) needs a Retrofit
    const { builds, linked } = buildsFor(cls, ctx);
    if (!declares && !linked) continue;
    for (const { m, verb } of methods) for (const b of builds.length > 0 ? builds : [undefined]) out.push(methodRaw(m, verb, b, ctx));
  }
  return out;
}
