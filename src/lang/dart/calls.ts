import type { CallExpr, Expr } from "../ir/model.js";
import { dottedPath } from "../ir/model.js";

/**
 * Calls and reads the lowering takes for the value they stand for: environment reads (`String.fromEnvironment('X',
 * defaultValue: 'd')`, flutter_dotenv's `dotenv.env['X']` and `dotenv.get('X', fallback: 'd')`, `Platform.environment['X']`)
 * and `Uri.parse(s)`, which is its string.
 */

const FROM_ENVIRONMENT = new Set(["String.fromEnvironment", "bool.fromEnvironment", "int.fromEnvironment"]);
const DOTENV_GETS = new Set(["dotenv.get", "dotenv.maybeGet", "dotenv.getOrElse", "DotEnv.get"]);
const ENV_MAPS = new Set(["dotenv.env", "Platform.environment", "io.Platform.environment"]);
const URI_PARSE = new Set(["Uri.parse", "Uri.tryParse"]);

const positional = (call: CallExpr): Expr[] => call.args.filter((a) => !a.name && !a.spread).map((a) => a.value);
const named = (call: CallExpr, name: string): Expr | undefined => call.args.find((a) => a.name === name)?.value;

/** The value a call stands for, when the lowering reads it as one; undefined for a call to record. */
export function specialCall(call: CallExpr): Expr | undefined {
  const path = dottedPath(call.fn)?.join(".");
  if (!path) return undefined;
  const [first] = positional(call);
  if (URI_PARSE.has(path) && first) return first;
  if (first?.k !== "str") return undefined;
  if (FROM_ENVIRONMENT.has(path)) {
    const fallback = named(call, "defaultValue");
    return { k: "env", name: first.v, ...(fallback ? { fallback } : {}) };
  }
  if (DOTENV_GETS.has(path)) {
    const fallback = named(call, "fallback") ?? positional(call)[1];
    return { k: "env", name: first.v, ...(fallback ? { fallback } : {}) };
  }
  return undefined;
}

/** `dotenv.env['X']`, `Platform.environment['X']`: an environment read; undefined for any other index. */
export function specialIndex(obj: Expr, key: Expr): Expr | undefined {
  const path = dottedPath(obj)?.join(".");
  return path && ENV_MAPS.has(path) && key.k === "str" ? { k: "env", name: key.v } : undefined;
}
