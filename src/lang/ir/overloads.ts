import type { CallExpr, Expr, FunctionDef, Param } from "./model.js";
import { lookup } from "./project.js";
import type { IrCtx } from "./raw.js";

/**
 * Overloaded methods (Java, Kotlin): a class keeps the first method of a name, the others are functions of the same
 * name in the same scope. A call runs the one its arguments fit: by count, then by the types of literal and declared
 * arguments. Several left, or none, and the call's target is not known.
 */

const NUMBERS = new Set(["Integer", "Int", "Long", "Short", "Byte", "Double", "Float", "Number", "BigDecimal", "BigInteger"]);

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

/** The type of an argument when it is cheap to know: a literal, a class reference, a typed parameter or local. */
function argType(e: Expr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (e.k === "str" || e.k === "tmpl") return "String";
  if (e.k === "num") return "Number";
  if (e.k === "bool") return "Boolean";
  if (e.k !== "name") return undefined;
  const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
  if (b.kind === "param") return typeName(b.param.type);
  return b.kind === "value" ? typeName(b.assign.type) : undefined;
}

/** Whether an argument of type `arg` can be given to a parameter declared `param`: only clear mismatches say no. */
function compatible(arg: string | undefined, param: Param | undefined): boolean {
  const declared = typeName(param?.type);
  if (!arg || !declared || declared === "Object" || declared === "Any" || declared === "T" || /^[A-Z]$/.test(declared)) return true;
  if (arg === "Number") return NUMBERS.has(declared) || /^(?:int|long|short|byte|double|float)$/.test(declared);
  if (arg === "String") return declared === "String" || declared === "CharSequence";
  if (arg === "Boolean") return declared === "Boolean" || declared === "boolean";
  // two declared types: a mismatch only between well-known value types
  const values = ["String", "Boolean", ...NUMBERS];
  return !(values.includes(arg) && values.includes(declared) && arg !== declared);
}

function fitsTypes(f: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx): boolean {
  const positional = f.params.filter((p) => p.kind === "normal");
  return call.args.every((a, i) => a.spread || compatible(argType(a.value, fn, ctx), a.name ? f.params.find((p) => p.name === a.name) : positional[i]));
}

/** The overload of `target` a call runs; `target` itself without overloads; undefined when the arguments do not tell. */
export function overloadFor(target: FunctionDef, call: CallExpr, fn: FunctionDef, ctx: IrCtx): FunctionDef | undefined {
  if (!ctx.idx.lang.overloads) return target;
  const all = siblingsOf(target);
  if (all.length <= 1) return target;
  const fitting = all.filter((f) => fitsCount(f, call));
  // an overload calling its own name delegates to another (`get(url) = get(url.toHttpUrl())`)
  const byCount = fitting.length > 1 ? fitting.filter((f) => f !== fn) : fitting;
  if (byCount.length <= 1) return byCount[0];
  const byType = byCount.filter((f) => fitsTypes(f, call, fn, ctx));
  return byType.length === 1 ? byType[0] : undefined;
}
