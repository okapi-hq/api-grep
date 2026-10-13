import type { CallExpr, Expr, FunctionDef, Param } from "./model.js";
import { classField, classFieldType, lookup, receiverClass } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * Overloaded methods (Java, Kotlin): a class keeps the first method of a name, the others are functions of the same
 * name in the same scope. A call runs the one its arguments fit: by count, then by the types of literal and declared
 * arguments. Several left, or none, and the call's target is not known.
 */

const NUMBERS = new Set(["Integer", "Int", "Long", "Short", "Byte", "Double", "Float", "Number", "BigDecimal", "BigInteger"]);
const CLASSES = new Set(["Class", "KClass"]);
const SYNTHETIC = new Set(["lambda", "anonymous", "constructor"]);
/** Types no other of the list is an instance of: two different ones never fit each other. */
const DISTINCT = new Set(["String", "Boolean", ...NUMBERS, ...CLASSES, "GenericType", "TypeReference", "ParameterizedTypeReference", "HttpUrl", "URI", "URL"]);

const siblingsOf = (target: FunctionDef): FunctionDef[] =>
  target.module.allFunctions.filter((f) => f.name === target.name && f.cls === target.cls && f.parent === target.parent);

/** Whether the call's arguments (named ones by name) can be given to `f`: each parameter without a default gets one. */
function fitsCount(f: FunctionDef, call: CallExpr): boolean {
  if (call.args.some((a) => a.spread)) return true;
  const named = call.args.filter((a) => a.name).map((a) => a.name!);
  if (named.some((n) => !f.params.some((p) => p.name === n))) return false;
  const normal = f.params.filter((p) => p.kind === "normal");
  const positional = call.args.length - named.length;
  if (positional > normal.length && !f.params.some((p) => p.kind !== "normal")) return false;
  return normal.every((p, i) => i < positional || !!p.default || named.includes(p.name));
}

/** The simple name of a declared type (`List<String>` lowers as an index of `List`). */
function typeName(t: Expr | undefined): string | undefined {
  const e = t?.k === "index" ? t.obj : t;
  return e?.k === "name" || e?.k === "attr" ? e.name : e?.k === "qname" ? e.path.at(-1) : undefined;
}

/** `new GenericType<X>() {}` (lowered as unknown when anonymous), `new Foo(...)`: the class built. */
function builtType(e: Expr): string | undefined {
  if (e.k === "call" && e.isNew) return typeName(e.fn);
  return e.k === "unknown" ? /^new\s+(?:[\w.]+\.)?(\w+)/.exec(e.text)?.[1] : undefined;
}

/** The type of an argument when it is cheap to know: a literal, a class reference, a typed parameter or local. */
function argType(e: Expr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (e.k === "str" || e.k === "tmpl") return "String";
  if (e.k === "num") return "Number";
  if (e.k === "bool") return "Boolean";
  if (e.k === "qname") return "Class";
  // a field of the class the code runs in (`this.LIST`, a bare `LIST` in Java)
  if (e.k === "attr" && e.obj.k === "this") {
    const cls = receiverClass(fn, ctx.self, ctx.idx);
    const field = cls ? classField(cls, e.name, ctx.idx)[0] : undefined;
    return cls ? (typeName(classFieldType(cls, e.name, ctx.idx)) ?? (field ? builtType(field.value) : undefined)) : undefined;
  }
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "param") return typeName(b.param.type);
  if (b.kind === "value") return typeName(b.assign.type) ?? builtType(b.assign.value);
  // `Version.class` lowers as the class itself
  return /^[A-Z](?=.*[a-z])/.test(e.name) && (b.kind === "class" || b.kind === "external" || b.kind === "none") ? "Class" : undefined;
}

/** Whether an argument of type `arg` can be given to a parameter declared `param`: only clear mismatches say no. */
function compatible(arg: string | undefined, param: Param | undefined): boolean {
  const declared = typeName(param?.type);
  if (!arg || !declared || declared === "Object" || declared === "Any" || declared === "T" || /^[A-Z]$/.test(declared)) return true;
  if (arg === "Number") return NUMBERS.has(declared) || /^(?:int|long|short|byte|double|float)$/.test(declared);
  if (arg === "String") return declared === "String" || declared === "CharSequence";
  if (arg === "Boolean") return declared === "Boolean" || declared === "boolean";
  if (CLASSES.has(arg) && CLASSES.has(declared)) return true;
  // two declared types: a mismatch only between well-known types
  return !(DISTINCT.has(arg) && DISTINCT.has(declared) && arg !== declared);
}

/** Whether an overload hands its call to another of its name (`GET(url: String) = GET(url.toHttpUrl(), ...)`). */
const delegates = (f: FunctionDef): boolean => f.calls.some((c) => (c.fn.k === "name" || (c.fn.k === "attr" && c.fn.obj.k === "this")) && c.fn.name === f.name);

function fitsTypes(f: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx): boolean {
  const positional = f.params.filter((p) => p.kind === "normal");
  return call.args.every((a, i) => a.spread || compatible(argType(a.value, fn, ctx), a.name ? f.params.find((p) => p.name === a.name) : positional[i]));
}

/** The overload of `target` a call runs; `target` itself without overloads; undefined when the arguments do not tell. */
export function overloadFor(target: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx): FunctionDef | undefined {
  const options = overloadsFor(target, call, fn, ctx);
  return options.length === 1 ? options[0] : undefined;
}

/** The overloads of `target` a call may run: one when its arguments tell, several when they do not, none when none fits. */
export function overloadsFor(target: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx): FunctionDef[] {
  // lambdas and constructors are not overloads of a name (Java's other constructors are functions of their own)
  if (!ctx.idx.lang.overloads || SYNTHETIC.has(target.name) || target.name.startsWith("<") || (call.fn.k !== "name" && call.fn.k !== "attr")) return [target];
  const all = siblingsOf(target);
  if (all.length <= 1) return [target];
  const fitting = all.filter((f) => fitsCount(f, call));
  // an overload calling its own name delegates to another (`get(url) = get(url.toHttpUrl())`)
  const byCount = fitting.length > 1 ? fitting.filter((f) => f !== fn) : fitting;
  if (byCount.length <= 1) return byCount;
  const byType = byCount.filter((f) => fitsTypes(f, call, fn, ctx));
  if (byType.length === 1) return byType;
  const left = byType.length > 0 ? byType : byCount;
  // convenience overloads that all end in one: whichever runs, that one builds the request
  const core = left.filter((f) => !delegates(f));
  return core.length === 1 ? core : left;
}
