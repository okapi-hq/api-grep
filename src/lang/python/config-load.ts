import { staticText } from "../../resolve/parts.js";
import { loadedConfigExpr } from "../ir/config-load.js";
import { evaluate } from "../ir/evaluate.js";
import type { Scoped } from "../ir/language.js";
import { dottedPath, type CallExpr, type Expr, type FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";

/**
 * Python config files loaded by a literal path: `yaml.safe_load(open("config.yaml"))`, `json.load(f)` with
 * `with open("settings.json") as f`, `json.loads(Path("x.json").read_text())`, `toml.load("config.toml")`,
 * `OmegaConf.load("conf.yaml")`, a path joined to the file's own directory
 * (`os.path.join(os.path.dirname(__file__), "config.yaml")`): the call stands for the file's value.
 */

const LOADERS = new Set([
  "yaml.safe_load",
  "yaml.load",
  "yaml.full_load",
  "json.load",
  "json.loads",
  "toml.load",
  "toml.loads",
  "tomllib.load",
  "tomllib.loads",
  "tomli.load",
  "tomli.loads",
  "omegaconf.OmegaConf.load",
]);
const OPENERS = new Set(["open", "io.open", "codecs.open", "pathlib.Path", "Path", "builtins.open"]);
const READERS = new Set(["read", "read_text", "read_bytes", "open"]);
const MAX_DEPTH = 6;

/** Names a loader or opener call can end with: checked before any lookup, as this runs for every call dereferenced. */
const LAST_NAMES = new Set([...LOADERS, ...OPENERS, "os.path.join"].map((n) => n.slice(n.lastIndexOf(".") + 1)));

/** The dotted library name a callee stands for through the module's imports (`yaml.safe_load`, `from json import load`). */
function calleeName(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  const path = dottedPath(call.fn);
  if (!path || !LAST_NAMES.has(path[path.length - 1]!)) return undefined;
  if (path.length === 1 && OPENERS.has(path[0]!)) return path[0];
  const head = lookup(path[0]!, fn, undefined, ctx.idx);
  return head.kind === "external" ? [...head.path, ...path.slice(1)].join(".") : undefined;
}

/** `os.path.dirname(os.path.abspath(__file__))`: an expression built from the file's own path. */
function fromFile(e: Expr, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (e.k === "name") return e.name === "__file__";
  if (e.k === "attr") return fromFile(e.obj, depth + 1);
  return e.k === "call" && (e.args.some((a) => fromFile(a.value, depth + 1)) || (e.fn.k === "attr" && fromFile(e.fn.obj, depth + 1)));
}

/** `os.path.join(os.path.dirname(__file__), "conf", "x.yaml")`: the literal rest, from the file's directory. */
function joinedToFile(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (calleeName(call, fn, ctx) !== "os.path.join" || call.args.length < 2 || !fromFile(call.args[0]!.value)) return undefined;
  const rest = call.args.slice(1).map((a) => staticText(evaluate(a.value, fn, ctx)));
  return rest.every((r) => r !== undefined) ? rest.join("/") : undefined;
}

/** The literal path a value opens or reads (`open("x.yaml")`, `Path("x.json").read_text()`, a name holding one). */
export function pathOf(e: Expr, fn: FunctionDef, ctx: IrCtx, depth = 0): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const d = deref(e, fn, ctx);
  const [x, xfn] = [d.expr, d.fn];
  if (x.k !== "call") return staticText(evaluate(x, xfn, ctx));
  if (x.fn.k === "attr" && READERS.has(x.fn.name)) return pathOf(x.fn.obj, xfn, ctx, depth + 1);
  const joined = joinedToFile(x, xfn, ctx);
  if (joined) return joined;
  const name = calleeName(x, xfn, ctx);
  const first = x.args[0];
  return name && OPENERS.has(name) && first && !first.name ? pathOf(first.value, xfn, ctx, depth + 1) : undefined;
}

/** `resolveCall` for Python: a config file a loader reads, as the value it gives. */
export function pythonConfigLoad(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" && call.fn.k !== "name") return undefined;
  const name = calleeName(call, fn, ctx);
  const first = call.args[0];
  if (!name || !LOADERS.has(name) || !first || first.name || first.spread) return undefined;
  const literal = pathOf(first.value, fn, ctx);
  const expr = literal ? loadedConfigExpr(literal, fn, ctx) : undefined;
  return expr ? { expr, fn } : undefined;
}
