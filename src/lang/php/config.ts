import { staticText } from "../../resolve/parts.js";
import { evaluate } from "../ir/evaluate.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, FunctionDef, ModuleModel } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";
import { dictOf, entryOf } from "../ir/values.js";

const CONFIG_CALLS = new Set(["config", "Config.get", "Illuminate.Support.Facades.Config.get"]);

function calleeOf(call: CallExpr): string | undefined {
  if (call.fn.k === "name") return call.fn.name;
  if (call.fn.k === "attr" && call.fn.obj.k === "qname") return `${call.fn.obj.path.join(".")}.${call.fn.name}`;
  return undefined;
}

/** `config/services.php` of the scanned project (the shortest path wins in a monorepo). */
function configFile(idx: IrCtx["idx"], name: string): ModuleModel | undefined {
  const suffix = `/config/${name}.php`;
  return idx
    .all()
    .filter((m) => m.file.replace(/\\/g, "/").endsWith(suffix))
    .sort((a, b) => a.file.length - b.file.length)[0];
}

/**
 * Laravel `config('services.stripe.url', $default)` and `Config::get(...)`: the entry of the array that
 * `config/services.php` returns, usually `env('STRIPE_URL', 'https://api.stripe.com')`; else the default argument.
 */
export function laravelConfig(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const callee = calleeOf(call);
  const keyArg = call.args[0];
  if (!callee || !CONFIG_CALLS.has(callee) || !keyArg) return undefined;
  const key = staticText(evaluate(keyArg.value, fn, ctx));
  const [file, ...path] = key?.split(".") ?? [];
  const mod = file ? configFile(ctx.idx, file) : undefined;
  const root = mod?.top.returns[0];
  let hit: Scoped | undefined = root ? { expr: root, fn: mod!.top } : undefined;
  for (const k of path) {
    const dict = hit ? dictOf(hit.expr, hit.fn, ctx) : undefined;
    hit = dict ? entryOf(dict, k, ctx) : undefined;
  }
  const fallback = call.args[1];
  return path.length > 0 && hit ? hit : fallback ? { expr: fallback.value, fn } : undefined;
}
