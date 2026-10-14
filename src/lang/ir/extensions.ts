import { typeChain, type Chain } from "./chain.js";
import type { ClassDef, FunctionDef } from "./model.js";
import { inherits } from "./project.js";
import type { IrCtx, Seg } from "./raw.js";

/**
 * Kotlin extension functions (`fun S3Client.delete(...)`, #86): `client.delete(b, k)` runs the one extension of that
 * name in scope whose receiver type is the type of `client`. The type of a value is read from its chain: a declared
 * type, a constructor (`HttpClient(CIO)`), a builder (`OkHttpClient.Builder()...build()`) or a static factory
 * (`S3Client.fromEnvironment()`); a value of no known type, or several extensions that fit, run none.
 */

/** A project class, or an external class by its dotted path. */
type TypeRef = { cls: ClassDef } | { path: string };

/** Static factories that return an instance of their class (`create()`, `fromEnvironment()`, `newHttpClient()`). */
const FACTORY = /^(?:create|from|new(?!Builder$)|getInstance$|default)/;

const isClass = (s: Seg | undefined): boolean => !!s && !s.call && /^[A-Z]/.test(s.name);

/** `X.Builder()...build()`, `X.builder()...build()`, `x.newBuilder()...build()`: an `X`. */
function builtType(segs: Seg[]): TypeRef | undefined {
  for (let i = segs.length - 2; i > 0; i--) {
    const s = segs[i]!;
    if (!s.call) return undefined;
    if (s.name === "Builder" || s.name === "builder" || s.name === "newBuilder") return isClass(segs[i - 1]) ? { path: pathOf(segs, i) } : undefined;
  }
  return undefined;
}

const pathOf = (segs: Seg[], n: number): string =>
  segs
    .slice(0, n)
    .map((s) => s.name)
    .join(".");

/** The type of the value a chain stands for, when its chain says. */
export function chainType(c: Chain): TypeRef | undefined {
  if (c.root.kind === "instance" && c.segs.length === 0) return { cls: c.root.cls };
  const segs = c.segs;
  const last = segs[segs.length - 1];
  if (c.root.kind !== "external" || !last) return undefined;
  if (last.typed) return { path: pathOf(segs, segs.length) };
  if (!last.call) return undefined;
  // `HttpClient(CIO)`, `OkHttpClient()`, `S3Client { ... }`, `OkHttpClient.Builder()`
  if (/^[A-Z]/.test(last.name)) return { path: pathOf(segs, segs.length) };
  if (last.name === "build") return builtType(segs);
  return FACTORY.test(last.name) && isClass(segs[segs.length - 2]) ? { path: pathOf(segs, segs.length - 1) } : undefined;
}

const receiverTypes = new WeakMap<FunctionDef, TypeRef | null>();

/** The receiver type of an extension, as a class of the project or an imported one. */
function receiverType(ext: FunctionDef, ctx: IrCtx): TypeRef | undefined {
  let t = receiverTypes.get(ext);
  if (t === undefined) {
    const c = ext.receiver?.type ? typeChain(ext.receiver.type, ext, ctx) : undefined;
    t = c ? (chainType(c) ?? null) : null;
    receiverTypes.set(ext, t);
  }
  return t ?? undefined;
}

function fits(want: TypeRef | undefined, have: TypeRef, ctx: IrCtx): boolean {
  if (!want) return false;
  if ("cls" in want) return "cls" in have && inherits(have.cls, want.cls, ctx.idx);
  return "path" in have && have.path === want.path;
}

const packageOf = (path: string[]): string[] => path.slice(0, Math.max(0, path.findIndex((s) => /^[A-Z]/.test(s))));

/**
 * `get(url)` imported from `io.ktor.client.request` in an extension of `io.ktor.client.HttpClient`: a library function
 * of the receiver's package (or one under it) called bare there is an extension of the receiver, not a function.
 */
export function libraryExtension(imported: string[], receiver: Chain): boolean {
  const t = chainType(receiver);
  if (!t || !("path" in t)) return false;
  const own = packageOf(t.path.split("."));
  const pkg = imported.slice(0, -1);
  return own.length >= 2 && own.length <= pkg.length && own.every((s, i) => pkg[i] === s);
}

/** An extension is called where its package is, or imports it (also whole); a member extension inside its class. */
function visible(ext: FunctionDef, from: FunctionDef): boolean {
  if (ext.cls) return from.cls === ext.cls;
  const mod = from.module;
  const pkg = ext.module.name;
  if (mod.name === pkg) return true;
  if (mod.imports.get(ext.name)?.path.join(".") === (pkg ? `${pkg}.${ext.name}` : ext.name)) return true;
  return (mod.wildcards ?? []).some((w) => w.join(".") === pkg);
}

/** Code of `ext` itself (its body, its lambdas): a call of its own name there is the receiver's member it wraps. */
function within(from: FunctionDef, ext: FunctionDef): boolean {
  for (let f: FunctionDef | undefined = from; f; f = f.parent) if (f === ext) return true;
  return false;
}

/**
 * The extension `name` of the value `c` stands for, called from `from`; its overloads in one file are told apart by
 * the call (`overloads.ts`), extensions of several files that fit are not.
 */
export function extensionFor(c: Chain, name: string, from: FunctionDef, ctx: IrCtx): FunctionDef | undefined {
  const cands = ctx.idx.extensions.get(name);
  if (!cands) return undefined;
  const type = chainType(c);
  if (!type) return undefined;
  const hits = cands.filter((f) => !within(from, f) && visible(f, from) && fits(receiverType(f, ctx), type, ctx));
  const first = hits[0];
  return first && hits.every((h) => h.module === first.module && h.cls === first.cls) ? first : undefined;
}
