import { valueChain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Expr, FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";

/**
 * `args.model` where `args = parser.parse_args()` (argparse): the `default=` of the `add_argument` that stores it
 * (`parser.add_argument("--model", default="gpt-4o")`, also on a group of the parser). A command line can give any
 * value: the default is one of them, read as a fallback.
 */

const MAX_DEPTH = 4;

/** The parser variable and the function it is built in, for a value `parser.parse_args()` returns (also through a helper). */
function parserOf(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): { name: string; fn: FunctionDef } | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (e.k === "name") {
    const b = lookup(e.name, fn, e.pos.offset, ctx.idx);
    return b.kind === "value" ? parserOf(b.assign.value, b.fn, ctx, depth + 1) : undefined;
  }
  if (e.k !== "call") return undefined;
  if (e.fn.k === "attr" && e.fn.name === "parse_args" && e.fn.obj.k === "name") return { name: e.fn.obj.name, fn };
  // `args = parse_args()`: a helper of the project that returns the parsed arguments
  const callee = valueChain(e.fn, fn, ctx);
  const helper = callee.root.kind === "function" && callee.segs.length === 0 ? callee.root.fn : undefined;
  return helper?.returns.length === 1 ? parserOf(helper.returns[0]!, helper, ctx, depth + 1) : undefined;
}

/** `--judge-model` stores in `judge_model`; `dest=` names it; a positional argument is its own name. */
function destOf(call: CallExpr): string | undefined {
  const dest = call.args.find((a) => a.name === "dest")?.value;
  if (dest?.k === "str") return dest.v;
  const flags = call.args.filter((a) => !a.name && a.value.k === "str").map((a) => (a.value as { v: string }).v);
  const long = flags.find((f) => f.startsWith("--")) ?? (flags[0] && !flags[0].startsWith("-") ? flags[0] : undefined) ?? flags[0];
  return long?.replace(/^-+/, "").replace(/-/g, "_");
}

/** Whether `obj` is the parser or one of its argument groups (`parser.add_argument_group(...)`). */
function onParser(obj: Expr, parser: string, fn: FunctionDef, ctx: IrCtx): boolean {
  if (obj.k !== "name") return false;
  if (obj.name === parser) return true;
  const b = lookup(obj.name, fn, obj.pos.offset, ctx.idx);
  const v = b.kind === "value" ? b.assign.value : undefined;
  return v?.k === "call" && v.fn.k === "attr" && /^add_(argument_group|mutually_exclusive_group)$/.test(v.fn.name) && v.fn.obj.k === "name" && v.fn.obj.name === parser;
}

/** The default an argparse namespace's attribute gets; undefined for anything else. */
export function argparseDefault(e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const parser = parserOf(e.obj, fn, ctx);
  if (!parser) return undefined;
  for (const call of parser.fn.calls) {
    if (call.fn.k !== "attr" || call.fn.name !== "add_argument" || !onParser(call.fn.obj, parser.name, parser.fn, ctx) || destOf(call) !== e.name) continue;
    const dflt = call.args.find((a) => a.name === "default")?.value;
    return dflt ? { expr: dflt, fn: parser.fn } : undefined;
  }
  return undefined;
}
