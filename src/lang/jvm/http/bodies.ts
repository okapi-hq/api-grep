import { scopedIn } from "../../ir/fluent.js";
import type { Scoped } from "../../ir/language.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "../../ir/model.js";
import { calleeIs, lambdaCalls, lambdaOf, type RequestParts } from "../../ir/steps.js";
import { applyStep } from "../../ir/steps.js";

/**
 * Ktor and kotlinx.serialization values built in a lambda (#46): `parameters { append(k, v) }`, `Parameters.build`,
 * `formData { append(k, v) }`, `buildJsonObject { put(k, v); putJsonObject(k) { ... } }`, read as dicts.
 */

const BUILDERS = ["parameters", "Parameters.build", "formData", "buildJsonObject", "buildJsonArray"];
const MAX_DEPTH = 4;

const positional = (c: CallExpr): Expr[] => c.args.filter((a) => !a.name && !a.spread && a.value.k !== "fnref").map((a) => a.value);
const own = (c: CallExpr): boolean => c.fn.k === "name" || (c.fn.k === "attr" && c.fn.obj.k === "this");
const nameOf = (c: CallExpr): string => (c.fn.k === "name" || c.fn.k === "attr" ? c.fn.name : "");

/** The entries (or items, for `buildJsonArray` / `putJsonArray`) a builder lambda adds, read in `into`. */
function built(lambda: FunctionDef, into: FunctionDef, array: boolean, depth: number): Expr {
  const entries: Entry[] = [];
  const items: Expr[] = [];
  for (const { call } of lambdaCalls(lambda).filter((c) => own(c.call))) {
    const [k, v] = positional(call).map((x) => scopedIn(x, lambda, into));
    const inner = lambdaOf(call);
    const name = nameOf(call);
    if (inner && depth < MAX_DEPTH && (name === "putJsonObject" || name === "putJsonArray" || name === "addJsonObject" || name === "addJsonArray")) {
      const value = built(inner, into, name.endsWith("Array"), depth + 1);
      if (name.startsWith("add")) items.push(value);
      else if (k) entries.push({ key: k, value });
    } else if (array && name === "add" && k) items.push(k);
    else if ((name === "append" || name === "put" || name === "set") && k && v) entries.push({ key: k, value: v });
  }
  return array ? { k: "list", items } : { k: "dict", entries };
}

/** A builder call of the list above, as the dict (or list) its lambda fills. */
function ktorBuilt(call: CallExpr, fn: FunctionDef): Scoped | undefined {
  const name = calleeIs(call, BUILDERS);
  const lambda = name ? lambdaOf(call) : undefined;
  return lambda ? { expr: built(lambda, fn, name === "buildJsonArray", 0), fn } : undefined;
}

const FORM_DATA = ["BodyInserters.fromFormData", "BodyInserters.fromMultipartData"];

/**
 * Spring `BodyInserters.fromFormData("grant_type", "password").with("scope", s)`: the same inserter of one map
 * (`fromFormData({grant_type: ..., scope: ...})`), which the body table reads as a form.
 */
function springFormData(call: CallExpr, fn: FunctionDef): Scoped | undefined {
  const pairs: Entry[] = [];
  let cur: Expr = call;
  for (let i = 0; i < 64 && cur.k === "call" && cur.fn.k === "attr" && cur.fn.name === "with"; i++) {
    const [k, v] = positional(cur);
    if (!k || !v) return undefined;
    pairs.unshift({ key: k, value: v });
    cur = cur.fn.obj;
  }
  const start = cur.k === "call" ? calleeIs(cur, FORM_DATA) : undefined;
  if (!start || cur.k !== "call") return undefined;
  const [k, v] = positional(cur);
  if (!k || !v) return undefined;
  const dict: Expr = { k: "dict", entries: [{ key: k, value: v }, ...pairs] };
  return { expr: { ...cur, args: [{ value: dict }] }, fn };
}

/** Bodies a library builds with helpers, as values the engine reads: Ktor's lambda builders, Spring's form inserters. */
export const httpBuilt = (call: CallExpr, fn: FunctionDef): Scoped | undefined => ktorBuilt(call, fn) ?? springFormData(call, fn);

/** The calls of a builder lambda named `name` among `fn`'s (`bearer { ... }` in `install(Auth) { ... }`). */
const block = (fn: FunctionDef, names: string[]): FunctionDef[] => fn.calls.flatMap((c) => (calleeIs(c, names) ? (lambdaOf(c) ?? []) : []));

/**
 * `install(Auth) { bearer { loadTokens { BearerTokens(access, refresh) } } }`, `basic { credentials { ... } }`: the
 * Authorization header the client sends with every request.
 */
export function ktorAuth(install: CallExpr, p: RequestParts): void {
  const auth = install.args[0]?.value;
  const lambda = auth?.k === "name" && auth.name === "Auth" ? lambdaOf(install) : undefined;
  if (!lambda) return;
  for (const tokens of block(lambda, ["bearer"]).flatMap((b) => block(b, ["loadTokens"]))) {
    const made = tokens.returns[0];
    if (made?.k !== "call" || !calleeIs(made, ["BearerTokens"])) continue;
    const named = made.args.find((a) => a.name === "accessToken");
    applyStep(p, { bearer: 0 }, { call: named ? { ...made, args: [{ value: named.value }] } : made, fn: tokens });
    return;
  }
  if (block(lambda, ["basic"]).length > 0) applyStep(p, { basic: true }, { call: install, fn: lambda });
}
