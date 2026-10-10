import { hasStaticHost, markConst, partsToTemplate, pickBranch, replaceInParts, staticText } from "../../resolve/parts.js";
import type { DynamicOrigin, Part, Shape } from "../../types.js";
import { calleeChain } from "./chain.js";
import { braceParts, printfParts, type FormatArgs } from "./format.js";
import { instanceField } from "./instance.js";
import { argFor, type Arg, type CallExpr, type Expr, type FunctionDef } from "./model.js";
import { bindingOfPath, classField, lookup, moduleMember, receiverClass, type Binding } from "./project.js";
import { withSelf, withSubst, type IrCtx, type Subst } from "./raw.js";
import { scalarShape } from "./types.js";
import { dictOf, dictValue } from "./values.js";

/** Steps followed to resolve one value (a name's value, a wrapper argument, a field): enough for four wrappers. */
const MAX_DEPTH = 10;

/** `$user_id` reads as `{user_id}`: PHP variables lose their sigil in placeholders. */
const bare = (name: string): string => name.replace(/^\$/, "");

export function dynamicName(e: Expr): string {
  switch (e.k) {
    case "name":
      return bare(e.name);
    case "attr":
      return bare(e.name);
    case "qname":
      return e.path[e.path.length - 1]!;
    case "index":
      return dynamicName(e.obj);
    case "call":
      return dynamicName(e.fn);
    case "cond":
      return dynamicName(e.then);
    case "env":
      return e.name;
    default:
      return "expr";
  }
}

function dyn(e: Expr, origin: DynamicOrigin, shape?: Shape): Part[] {
  return [{ kind: "dynamic", name: dynamicName(e), origin, ...(shape ? { shape } : {}) }];
}

/** `owner = get_param("owner")` reads better as `{owner}` than `{get_param}`. */
function renameSingle(parts: Part[], name: string): Part[] {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (!only || only.kind !== "dynamic" || (only.origin !== "call" && only.name !== "expr")) return parts;
  return [{ ...only, name: bare(name) }];
}

function evalBinding(b: Binding, e: Expr & { k: "name" }, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] {
  if (b.kind === "param") {
    const sub = ctx.subst?.get(b.param);
    if (sub) return evaluate(sub.expr, sub.fn, ctx, depth + 1);
    // a parameter nobody substituted: its literal default (`base_url="https://api.gladia.io"`) is the best static guess
    const dflt = b.param.default ? evaluate(b.param.default, b.fn, ctx, depth + 1) : undefined;
    if (dflt && staticText(dflt) !== undefined && b.param.default?.k !== "null") return markConst(dflt);
    return dyn(e, "param", b.param.type ? scalarShape(b.param.type) : undefined);
  }
  if (b.kind === "value") {
    const value = renameSingle(markConst(evaluate(b.assign.value, b.fn, ctx, depth + 1)), e.name);
    if (!b.assign.augmented) return value;
    const prev = lookup(e.name, b.fn, b.assign.offset, ctx.idx);
    const before = prev.kind === "value" && prev.assign !== b.assign ? evalBinding(prev, e, fn, ctx, depth + 1) : [];
    return [...before, ...value];
  }
  return dyn(e, "unknown");
}

function evalAttr(e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] {
  if (e.obj.k === "this" && fn.cls) {
    // `self.base_url` set in the constructor (or a class attribute / property default), on the object's own class first
    for (const f of classField(receiverClass(fn, ctx.self, ctx.idx)!, e.name, ctx.idx)) {
      const parts = evaluate(f.value, f.fn, ctx, depth + 1);
      if (parts.some((p) => p.kind !== "dynamic")) return markConst(parts);
    }
    return dyn(e, "unknown");
  }
  const member = memberValue(e, fn, ctx, depth);
  if (member) return member;
  const field = instanceField(e.obj, e.name, fn, ctx);
  if (field) return evaluate(field.expr, field.fn, field.ctx, depth + 1);
  const objParam = e.obj.k === "name" && lookup(e.obj.name, fn, e.pos.offset, ctx.idx).kind === "param";
  return dyn(e, objParam ? "param" : "unknown");
}

/** `config.BASE_URL` (a project module), `Settings.API` / `self::BASE` (a class constant). */
function memberValue(e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const owner = e.obj.k === "name" ? lookup(e.obj.name, fn, e.pos.offset, ctx.idx) : e.obj.k === "qname" ? bindingOfPath(e.obj.path, ctx.idx) : undefined;
  if (owner?.kind === "module") {
    const b = moduleMember(owner.mod, e.name, ctx.idx);
    if (b.kind === "value") return markConst(evaluate(b.assign.value, b.fn, ctx, depth + 1));
  }
  if (owner?.kind === "class") {
    const f = classField(owner.cls, e.name, ctx.idx)[0];
    if (f) return markConst(evaluate(f.value, f.fn, ctx, depth + 1));
  }
  return undefined;
}

function formatArgs(args: Arg[], fn: FunctionDef, ctx: IrCtx, depth: number): FormatArgs {
  const out: FormatArgs = { positional: [], named: new Map() };
  for (const a of args) {
    if (a.spread === "dict") {
      const dict = dictOf(a.value, fn, ctx);
      for (const en of dict?.entries ?? []) if (en.key?.k === "str") out.named.set(en.key.v, evaluate(en.value, dict!.fn, ctx, depth + 1));
    } else if (a.name) out.named.set(a.name, evaluate(a.value, fn, ctx, depth + 1));
    else if (a.value.k === "dict" && args.length === 1) {
      for (const en of a.value.entries) if (en.key?.k === "str") out.named.set(en.key.v, evaluate(en.value, fn, ctx, depth + 1));
    } else out.positional.push(evaluate(a.value, fn, ctx, depth + 1));
  }
  return out;
}

function evalFormat(e: Expr & { k: "format" }, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] {
  const template = staticText(evaluate(e.template, fn, ctx, depth + 1));
  if (template === undefined) return dyn(e.template, "unknown");
  const args = formatArgs(e.args, fn, ctx, depth);
  return e.style === "printf" ? printfParts(template, args) : braceParts(template, args);
}

/** `HOSTS[region]` with an unknown key: the first entry with a literal host, the best static guess (as for a conditional). */
function tableGuess(e: Expr & { k: "index" }, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const dict = dictOf(e.obj, fn, ctx);
  for (const en of dict?.entries ?? []) {
    const parts = en.spread ? undefined : evaluate(en.value, dict!.fn, ctx, depth + 1);
    if (parts && hasStaticHost(parts)) return markConst(parts);
  }
  return undefined;
}

/** `a or "https://host"`: an env var on the left wins (it can override) and keeps the literal right side as its default. */
function evalDefault(left: Expr, right: Expr, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] {
  const l = evaluate(left, fn, ctx, depth + 1);
  const r = evaluate(right, fn, ctx, depth + 1);
  const env = l.findIndex((p) => p.kind === "env");
  // `$url ?? ''`: an empty default says nothing, the left side stays
  if (env < 0 && staticText(r) === "") return l;
  // `url or "https://..."` with `url = ""`: an empty string is falsy, the right side runs
  if (env < 0) return staticText(l) && left.k !== "null" ? l : r;
  const fallback = staticText(r);
  if (fallback === undefined) return l;
  return l.map((p, i) => (i === env && p.kind === "env" ? { ...p, fallback } : p));
}

export function evaluate(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): Part[] {
  if (depth > MAX_DEPTH) return dyn(e, "unknown");
  switch (e.k) {
    case "str":
      return [{ kind: "static", text: e.v }];
    case "num":
      return [{ kind: "static", text: String(e.v) }];
    case "tmpl":
    case "concat":
      return e.parts.flatMap((p) => evaluate(p, fn, ctx, depth + 1));
    case "or":
      return evalDefault(e.left, e.right, fn, ctx, depth);
    case "cond":
      return pickBranch(evaluate(e.then, fn, ctx, depth + 1), evaluate(e.else, fn, ctx, depth + 1)) ?? dyn(e, "unknown");
    case "format":
      return evalFormat(e, fn, ctx, depth);
    case "env": {
      const fallback = e.fallback ? staticText(evaluate(e.fallback, fn, ctx, depth + 1)) : undefined;
      return [{ kind: "env", name: e.name, ...(fallback ? { fallback } : {}) }];
    }
    case "name":
      return evalBinding(lookup(e.name, fn, e.pos.offset, ctx.idx), e, fn, ctx, depth);
    case "attr":
      return evalAttr(e, fn, ctx, depth);
    case "index": {
      const v = dictValue(e, fn, ctx);
      return v ? markConst(evaluate(v.expr, v.fn, ctx, depth + 1)) : (tableGuess(e, fn, ctx, depth) ?? dyn(e, "unknown"));
    }
    case "call":
      return evalCall(e, fn, ctx, depth);
    default:
      return dyn(e, "unknown");
  }
}

const calleeName = (call: CallExpr): string | undefined => (call.fn.k === "name" ? call.fn.name : call.fn.k === "attr" ? call.fn.name : call.fn.k === "qname" ? call.fn.path[call.fn.path.length - 1] : undefined);

/** `"/".join([a, b])` / `implode('/', [$a, $b])`. */
function joinParts(call: CallExpr, name: string, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const [sepExpr, listExpr] = name === "join" && call.fn.k === "attr" ? [call.fn.obj, call.args[0]?.value] : [call.args[0]?.value, call.args[1]?.value];
  const sep = sepExpr ? staticText(evaluate(sepExpr, fn, ctx, depth + 1)) : undefined;
  const list = listExpr?.k === "list" ? listExpr.items : undefined;
  if (sep === undefined || !list) return undefined;
  return list.flatMap((item, i) => [...(i ? [{ kind: "static", text: sep } as Part] : []), ...evaluate(item, fn, ctx, depth + 1)]);
}

/** `urljoin(base, path)`: an absolute path wins, a leading slash replaces the base path. */
function urljoinParts(call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const [b, p] = call.args;
  if (!b || !p) return undefined;
  const base = evaluate(b.value, fn, ctx, depth + 1);
  const path = evaluate(p.value, fn, ctx, depth + 1);
  const pathText = partsToTemplate(path);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathText)) return path;
  const origin = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(partsToTemplate(base));
  if (pathText.startsWith("/") && origin && staticText(base) !== undefined) return [{ kind: "static", text: origin[1]! }, ...path];
  const sep: Part[] = partsToTemplate(base).endsWith("/") || pathText.startsWith("/") ? [] : [{ kind: "static", text: "/" }];
  return [...base, ...sep, ...path];
}

function evalCall(call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] {
  const resolved = ctx.idx.lang.resolveCall?.(call, fn, ctx);
  if (resolved) return markConst(evaluate(resolved.expr, resolved.fn, ctx, depth + 1));
  const name = calleeName(call);
  const pass = ctx.idx.lang.passthrough;
  if (name && pass.methods.has(name) && call.fn.k === "attr") return evaluate(call.fn.obj, fn, ctx, depth + 1);
  if (name && pass.functions.has(name) && call.args[0]) return evaluate(call.args[0].value, fn, ctx, depth + 1);
  if (name === "join" || name === "implode") {
    const joined = joinParts(call, name, fn, ctx, depth);
    if (joined) return joined;
  }
  if (name === "urljoin") {
    const joined = urljoinParts(call, fn, ctx, depth);
    if (joined) return joined;
  }
  return replaceParts(call, name, fn, ctx, depth) ?? helperResult(call, fn, ctx, depth) ?? dyn(call, "call");
}

/**
 * `s.replace("{id}", v)` (Python), `str_replace('{id}', $v, $s)` (PHP): the literal swapped in the static text. A regex
 * (`re.sub`, `preg_replace`) is never run on the scanned code's behalf: the subject stays as it is.
 */
function replaceParts(call: CallExpr, name: string | undefined, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const [a, b, c] = call.args.map((x) => (x.name || x.spread ? undefined : x.value));
  if (name === "replace" && call.fn.k === "attr" && a && b) return literalReplace(call.fn.obj, a, b, fn, ctx, depth);
  if (name === "str_replace" && a && b && c) return literalReplace(c, a, b, fn, ctx, depth);
  const regex = name === "preg_replace" || (name === "sub" && call.fn.k === "attr" && call.fn.obj.k === "name" && call.fn.obj.name === "re");
  return regex && c ? evaluate(c, fn, ctx, depth + 1) : undefined;
}

function literalReplace(subject: Expr, needle: Expr, replacement: Expr, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const text = staticText(evaluate(needle, fn, ctx, depth + 1));
  if (!text) return undefined;
  return replaceInParts(evaluate(subject, fn, ctx, depth + 1), text, evaluate(replacement, fn, ctx, depth + 1), true);
}

/** What a project URL helper returns (`api_url("sendMessage")`), when that says more than the call itself. */
function helperResult(call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number): Part[] | undefined {
  const target = calleeChain(call, fn, ctx);
  if (target.root.kind !== "function" || target.segs.length > 0) return undefined;
  const helper = target.root.fn;
  if (helper.returns.length !== 1) return undefined;
  const subst: Subst = new Map();
  for (const p of helper.params) {
    const arg = argFor(call, p);
    if (arg) subst.set(p, { expr: arg.value, fn });
  }
  // `$this->getEndpoint()`: the helper runs on the same object, whose class may override what it reads
  const self = call.fn.k === "attr" && call.fn.obj.k === "this" ? receiverClass(fn, ctx.self, ctx.idx) : undefined;
  const parts = evaluate(helper.returns[0]!, helper, withSelf(withSubst(ctx, subst), self), depth + 1);
  return parts.some((p) => p.kind === "env" || (p.kind === "static" && p.text !== "")) ? parts : undefined;
}
