import type { CallExpr, ClassDef, Expr, FunctionDef } from "../../ir/model.js";
import { projectBases } from "../../ir/project.js";
import type { IrCtx } from "../../ir/raw.js";
import { lambdaOf } from "../../ir/steps.js";
import type { Provider } from "./providers.js";
import { providedType, typeKey } from "./types.js";

/**
 * Bindings under more types than their own (#75): Spring beans by the interfaces and base classes of their class, Koin
 * definitions with `bind` / `binds`; and the definitions of Injekt, a service locator (`addSingletonFactory { ... }`).
 */

const MAX_BASES = 8;

/** The project class a binding's type names. */
function projectClass(full: string | undefined, ctx: IrCtx): ClassDef | undefined {
  const hit = full ? ctx.idx.resolvePath(full.split(".")) : undefined;
  return hit?.member.kind === "class" && hit.rest.length === 0 ? hit.member.cls : undefined;
}

/**
 * A Spring bean of a project class is also a bean of the types that class extends or implements
 * (`@Component class AuthInterceptor : ClientHttpRequestInterceptor`), as Spring resolves an injection point by type.
 */
export function springAliases(p: Provider, ctx: IrCtx): Provider[] {
  const cls = p.framework === "spring" && !p.bag ? projectClass(p.key.full, ctx) : undefined;
  if (!cls) return [];
  const out: Provider[] = [];
  const seen = new Set<ClassDef>([cls]);
  const queue = [cls];
  while (queue.length > 0 && out.length < MAX_BASES) {
    const c = queue.shift()!;
    for (const b of c.bases) {
      const key = typeKey(b, c.module.top, ctx);
      if (key && key.full !== p.key.full) out.push({ ...p, key });
    }
    for (const b of projectBases(c, ctx.idx)) {
      if (seen.has(b)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  return out;
}

/** The types a `bind` / `binds` call names: `bind<Api>()`, `bind(Api::class)`, `binds(arrayOf(A::class, B::class))`. */
function boundTypes(call: CallExpr): Expr[] {
  if (call.typeArgs?.length) return call.typeArgs;
  return call.args.flatMap((a) => (a.value.k === "list" ? a.value.items : [a.value]));
}

const isBind = (c: CallExpr, name: string): boolean => (c.fn.k === "name" || c.fn.k === "attr") && c.fn.name === name;

/**
 * Koin: `single { Impl() } bind Api::class`, `single { Impl() }.bind<Api>()`, `.binds(arrayOf(...))` and
 * `singleOf(::Impl) { bind<Api>() }`: the definition is also a binding of those types.
 */
export function koinBound(call: CallExpr, fn: FunctionDef, ctx: IrCtx, providerOf: (c: CallExpr) => Provider | undefined): Provider[] {
  const chained = (isBind(call, "bind") || isBind(call, "binds")) && call.fn.k === "attr" && call.fn.obj.k === "call" ? { def: call.fn.obj, binds: [call] } : undefined;
  const options = chained ? undefined : lambdaOf(call);
  const inOptions = options && call.fn.k === "name" && call.fn.name.endsWith("Of") ? options.calls.filter((c) => c.fn.k === "name" && (c.fn.name === "bind" || c.fn.name === "binds")) : [];
  const found = chained ?? (inOptions.length > 0 ? { def: call, binds: inOptions } : undefined);
  const p = found ? providerOf(found.def) : undefined;
  if (!p || !found) return [];
  return found.binds.flatMap(boundTypes).flatMap((t) => {
    const key = typeKey(t, fn, ctx);
    return key ? [{ ...p, key }] : [];
  });
}

const INJEKT_DEFS = new Set(["addSingleton", "addSingletonFactory", "addFactory", "addPerThreadFactory"]);

/** Injekt: `addSingletonFactory { OkHttpClient.Builder()...build() }`, `addSingleton(client)`, `addFactory<Api> { ... }`. */
export function injektProvider(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Provider | undefined {
  if ((call.fn.k !== "name" && call.fn.k !== "attr") || !INJEKT_DEFS.has(call.fn.name)) return undefined;
  const lambda = call.fn.name === "addSingleton" ? undefined : lambdaOf(call);
  const ret = lambda ? (lambda.returns.length === 1 ? { expr: lambda.returns[0]!, fn: lambda } : undefined) : call.args[0] && !call.args[0].name ? { expr: call.args[0].value, fn } : undefined;
  const key = call.typeArgs?.[0] ? typeKey(call.typeArgs[0], fn, ctx) : ret ? providedType(ret.expr, ret.fn, ctx) : undefined;
  return key ? { key, quals: [], framework: "injekt", ...(ret ? { value: ret } : {}) } : undefined;
}
