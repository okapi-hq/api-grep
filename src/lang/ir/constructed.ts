import { fieldsDict, sdkRules } from "./builders.js";
import type { Scoped } from "./language.js";
import type { CallExpr, FunctionDef, ModuleModel } from "./model.js";
import type { IrCtx } from "./raw.js";

/**
 * Kotlin SDKs whose parameters are data classes (openai-kotlin): `ChatCompletionRequest(model = ModelId("gpt-4o"),
 * maxTokens = 100)` reads as the dict of its named arguments under the SDK's setter rules (`setters.constructors`);
 * `ModelId("gpt-4o")`, a wrapper (`setters.wrappers`), as its argument.
 */

const dataClassFiles = new WeakMap<ModuleModel, boolean>();

/** Whether the file imports from a package whose classes are built by their constructor (a cheap test for every call). */
function importsDataClasses(mod: ModuleModel, ctx: IrCtx): boolean {
  let known = dataClassFiles.get(mod);
  if (known === undefined) {
    const packages = ctx.idx.lang.registry.flatMap((r) => (r.setters?.constructors || r.setters?.wrappers ? r.setters.packages : []));
    known = packages.length > 0 && mod.importPaths.some((p) => packages.some((pkg) => `${p.join(".")}.`.startsWith(`${pkg}.`)));
    dataClassFiles.set(mod, known);
  }
  return known;
}

export function constructedValue(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const name = call.fn.k === "name" || call.fn.k === "attr" ? call.fn.name : "";
  if (!/^[A-Z]/.test(name) || call.args.length === 0 || call.args.some((a) => a.spread) || !importsDataClasses(fn.module, ctx)) return undefined;
  const rules = sdkRules(call.fn, fn, ctx);
  if (!rules) return undefined;
  if (rules.wrappers?.includes(name)) return call.args.length === 1 ? { expr: call.args[0]!.value, fn } : undefined;
  if (!rules.constructors || call.args.some((a) => !a.name)) return undefined;
  return { expr: fieldsDict(call.args.map((a) => ({ name: a.name!, value: a.value })), fn, ctx, rules), fn };
}
