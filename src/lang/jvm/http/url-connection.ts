import { partsToTemplate } from "../../../resolve/parts.js";
import type { Chain } from "../../ir/chain.js";
import { evaluate } from "../../ir/evaluate.js";
import { callsOn } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import { children, exprText, type CallExpr, type Expr, type FunctionDef } from "../../ir/model.js";
import type { IrCtx, IrRaw } from "../../ir/raw.js";
import { argAt, calleeIs, emptyParts, type RequestParts } from "../../ir/steps.js";
import { rawOf } from "./request.js";

const WRITES = ["write", "writeBytes", "print", "println"];

/** The variable an `openConnection()` result is assigned to (`val conn = URL(u).openConnection() as HttpURLConnection`). */
function connectionVar(call: CallExpr, fn: FunctionDef): { name: string; offset: number } | undefined {
  const a = fn.assigns.find((x) => x.value === call);
  return a ? { name: a.target, offset: a.offset } : undefined;
}

const STREAM = /outputStream|getOutputStream|^it$|writer/i;

/** An expression that is the connection's output stream or wraps it (`new DataOutputStream(conn.getOutputStream())`). */
const mentionsStream = (e: Expr, depth = 0): boolean => STREAM.test(exprText(e)) || (depth < 4 && children(e).some((c) => mentionsStream(c, depth + 1)));

/**
 * `conn.outputStream.write(json.toByteArray())`, `conn.outputStream.use { it.write(...) }`, Java's `os.write(...)` on a
 * local holding the stream (`try (OutputStream os = conn.getOutputStream())`): what the function writes to the connection.
 */
function written(fn: FunctionDef, after: number): Scoped | undefined {
  const fns = [fn, ...fn.module.allFunctions.filter((f) => f.parent === fn)];
  const streams = new Set(fn.assigns.filter((a) => a.offset > after && mentionsStream(a.value)).map((a) => a.target));
  for (const f of fns) {
    for (const c of f.calls) {
      const target = c.fn.k === "attr" ? exprText(c.fn.obj) : "";
      const stream = STREAM.test(target) || streams.has(target) || f !== fn;
      if (c.pos.offset > after && calleeIs(c, WRITES) && stream) return argAt({ call: c, fn: f }, 0);
    }
  }
  return undefined;
}

/** `requestMethod = "POST"` / `setRequestMethod("POST")`, `setRequestProperty(k, v)`, `doOutput = true` on the connection variable. */
function configure(p: RequestParts, fn: FunctionDef, v: { name: string; offset: number }): boolean {
  let output = false;
  for (const c of callsOn(fn, v.name, v.offset)) {
    const at = (i: number): Scoped | undefined => argAt(c, i);
    if (calleeIs(c.call, ["setRequestMethod"])) p.method = at(0);
    else if (calleeIs(c.call, ["setRequestProperty", "addRequestProperty"]) && at(0)) p.pairs.push({ where: "header", name: at(0)!, value: at(1) });
    else if (calleeIs(c.call, ["setDoOutput"])) output = true;
  }
  for (const a of fn.assigns) {
    if (a.offset <= v.offset) continue;
    if (a.target === `${v.name}.requestMethod`) p.method = { expr: a.value, fn };
    if (a.target === `${v.name}.doOutput` && !(a.value.k === "bool" && !a.value.v)) output = true;
  }
  return output;
}

/**
 * `URL(u).openConnection()` (`HttpURLConnection`), reported where the connection is opened: the method, headers and
 * body come from what the same function does with it. Without a method, a connection that writes a body POSTs.
 */
export function detectUrlConnection(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  const last = chain.segs[chain.segs.length - 1];
  if (call.fn.k !== "attr" || call.fn.name !== "openConnection" || (last && last.call !== call)) return undefined;
  const p = emptyParts();
  p.url = { expr: call.fn.obj, fn };
  const v = connectionVar(call, fn);
  const output = v ? configure(p, fn, v) : false;
  // `getResource(...).openConnection()` is not a request: an http(s) URL, or the HTTP settings of a connection, tell
  const text = partsToTemplate(evaluate(p.url.expr, fn, ctx));
  if (!/^(?:https?:\/\/|\{env:)/i.test(text) && !p.method && p.pairs.length === 0) return undefined;
  p.body = v && (output || p.method) ? written(fn, v.offset) : undefined;
  if (!p.method) p.impliedMethod = output || p.body ? "POST" : "GET";
  return rawOf(call, fn, "java-http", p, ctx);
}
