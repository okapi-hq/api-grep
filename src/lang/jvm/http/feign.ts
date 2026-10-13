import { valueChain } from "../../ir/chain.js";
import type { Scoped } from "../../ir/language.js";
import type { Annotation, CallExpr, ClassDef, Expr, FunctionDef, ModuleModel } from "../../ir/model.js";
import type { IrCtx, IrPair, IrRaw } from "../../ir/raw.js";
import { argAt, calleeIs } from "../../ir/steps.js";
import { springPlaceholders } from "../placeholders.js";
import { annArg, annName, findAnn, headerLines, literal, paramRef } from "./annotations.js";
import { JVM } from "./tables.js";

const F = JVM.feign;
const SLASH: Expr = { k: "str", v: "/" };

/** `"${items.url:https://api.example.com}"`: a Spring property with its default. */
const configured = (e: Expr | undefined): Expr | undefined => (e?.k === "str" && e.v.includes("${") ? springPlaceholders(e.v) : e);

/** The method and path a method's mapping gives: `@GetMapping("/v1/items/{id}")`, `@RequestLine("GET /v1/items/{id}")`. */
function mapping(m: FunctionDef): { method?: string; methodExpr?: Expr; path?: Expr } | undefined {
  const line = literal(annArg(findAnn(m.annotations, [F.requestLine]), ["value"]));
  if (line) {
    const [verb, ...rest] = line.trim().split(/\s+/);
    return { method: verb, path: { k: "str", v: rest.join(" ") } };
  }
  const a = findAnn(m.annotations, Object.keys(F.mappings));
  if (!a) return undefined;
  const verb = F.mappings[annName(a)!];
  return { ...(verb ? { method: verb } : { methodExpr: annArg(a, ["method"]) }), path: annArg(a, ["value", "path"]) };
}

interface Params {
  pairs: IrPair[];
  body?: Scoped;
  query?: Scoped;
  headers: Scoped[];
}

/** `@RequestParam("q")`, `@RequestHeader("X")`, `@RequestBody`, `@SpringQueryMap`; an unannotated parameter not in the path is the body. */
function params(m: FunctionDef, path: string, sends: boolean): Params {
  const out: Params = { pairs: [], headers: [] };
  for (const p of m.params) {
    const a = findAnn(p.annotations, Object.keys(F.params));
    const role = a ? F.params[annName(a)!] : undefined;
    const name: Scoped = { expr: { k: "str", v: literal(annArg(a, ["value", "name"])) ?? p.name }, fn: m };
    if (role === "query" && !path.includes(`{${literal(name.expr) ?? ""}}`)) out.pairs.push({ where: "query", name, value: paramRef(p, m) });
    else if (role === "header") out.pairs.push({ where: "header", name, value: paramRef(p, m) });
    else if (role === "body" || (!a && !p.annotations?.length && sends && !path.includes(`{${p.name}}`) && !out.body)) out.body = paramRef(p, m);
    else if (role === "queryMap") out.query = paramRef(p, m);
    else if (role === "headers") out.headers.push(paramRef(p, m));
  }
  return out;
}

const targets = new WeakMap<ModuleModel[], Map<ClassDef, Scoped>>();

/** `Feign.builder()...target(ItemsClient::class.java, "https://api.example.com")`: the URL given for each interface. */
function targetUrl(cls: ClassDef, ctx: IrCtx): Scoped | undefined {
  const all = ctx.idx.all();
  let found = targets.get(all);
  if (!found) {
    found = new Map();
    for (const fn of all.flatMap((mod) => mod.allFunctions)) {
      for (const c of fn.calls.filter((x: CallExpr) => calleeIs(x, F.targets) && x.args.length >= 2)) {
        const iface = valueChain(c.args[0]!.value, fn, ctx);
        const url = argAt({ call: c, fn }, 1);
        if (iface.root.kind === "class" && url && !found.has(iface.root.cls)) found.set(iface.root.cls, url);
      }
    }
    targets.set(all, found);
  }
  return found.get(cls);
}

function methodRaw(m: FunctionDef, cls: ClassDef, client: Annotation | undefined, ctx: IrCtx): IrRaw | undefined {
  const map = mapping(m);
  if (!map) return undefined;
  const prefixes = [annArg(client, ["path"]), annArg(findAnn(cls.classAnnotations, ["RequestMapping"]), ["value", "path"])].filter((e): e is Expr => !!e);
  // each piece is a path of its own: a `/` before it unless it starts with one
  const parts = [...prefixes, ...(map.path ? [map.path] : [])].flatMap((e) => (literal(e)?.startsWith("/") ? [e] : [SLASH, e]));
  const sends = !["GET", "HEAD", "DELETE", "OPTIONS"].includes(map.method?.toUpperCase() ?? "GET");
  const ps = params(m, parts.map((e) => literal(e) ?? "").join(""), sends);
  const baseExpr = configured(annArg(client, ["url"]));
  const call: CallExpr = { k: "call", fn: { k: "name", name: m.name, pos: m.pos }, args: [], pos: m.pos };
  const pairs = [...headerLines(findAnn(cls.classAnnotations, [F.headers]), m), ...headerLines(findAnn(m.annotations, [F.headers]), m), ...ps.pairs];
  return {
    call,
    fn: m,
    client: "feign",
    url: parts.length > 0 ? { expr: { k: "tmpl", parts }, fn: m } : undefined,
    baseUrl: baseExpr ? { expr: baseExpr, fn: m } : targetUrl(cls, ctx),
    impliedMethod: map.method,
    method: map.methodExpr ? { expr: map.methodExpr, fn: m } : undefined,
    body: ps.body,
    query: ps.query,
    headers: ps.headers,
    pairs,
    inputs: [],
  };
}

/** OpenFeign: one request per mapped method of a `@FeignClient` interface (or a Feign interface given to `target(...)`), at the method. */
export function detectFeign(mod: ModuleModel, ctx: IrCtx): IrRaw[] {
  const out: IrRaw[] = [];
  for (const cls of mod.classes.values()) {
    const client = findAnn(cls.classAnnotations, F.clients);
    if (!client && !targetUrl(cls, ctx)) continue;
    for (const m of cls.methods.values()) {
      const raw = m.name !== "<init>" ? methodRaw(m, cls, client, ctx) : undefined;
      if (raw) out.push(raw);
    }
  }
  return out;
}
