import type { IrInjection, Scoped } from "../ir/language.js";
import { argFor, dottedPath, type CallExpr, type ClassDef, type Expr, type FunctionDef, type Param } from "../ir/model.js";
import { lookup, type ProjectIndex } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";

/**
 * Values a Dart app hands its objects without the scan seeing an assignment: a constructor's parameter given at the
 * class's one construction in the project (`ApiService(this._dio)` built once as `ApiService(dio)`), a Riverpod
 * provider read (`ref.watch(dioProvider)` is what `Provider((ref) => Dio(...))` returns), and a get_it lookup
 * (`getIt<Dio>()` is what the one `registerLazySingleton<Dio>(() => Dio(...))` builds). Several constructions or
 * registrations leave the value unknown.
 */

interface Site {
  call: CallExpr;
  fn: FunctionDef;
}

interface Index {
  constructions: Map<ClassDef, Site[]>;
  /** get_it registrations by the type they register. */
  registrations: Map<string, Scoped[]>;
}

const indexes = new WeakMap<ProjectIndex, Index>();
const REGISTER = /^register(?:LazySingleton|Singleton|Factory)(?:Async)?$/;
const typeName = (e: Expr | undefined): string | undefined => (e ? dottedPath(e)?.at(-1) : undefined);

/** A registration's value: the factory's return (`() => Dio(...)`), or the instance given. */
function registered(call: CallExpr, fn: FunctionDef): Scoped | undefined {
  const arg = call.args.find((a) => !a.name)?.value;
  if (arg?.k === "fnref") return arg.fn.returns.length === 1 ? { expr: arg.fn.returns[0]!, fn: arg.fn } : undefined;
  return arg ? { expr: arg, fn } : undefined;
}

function indexOf(idx: ProjectIndex): Index {
  let out = indexes.get(idx);
  if (out) return out;
  out = { constructions: new Map(), registrations: new Map() };
  for (const m of idx.all()) {
    for (const fn of m.allFunctions) {
      for (const call of fn.calls) {
        const name = call.fn.k === "name" ? call.fn.name : call.fn.k === "attr" ? call.fn.name : undefined;
        if (name && REGISTER.test(name)) {
          const value = registered(call, fn);
          const type = typeName(call.typeArgs?.[0]) ?? (value?.expr.k === "call" ? typeName(value.expr.fn) : undefined);
          if (value && type) out.registrations.set(type, [...(out.registrations.get(type) ?? []), value]);
        }
        if (call.fn.k !== "name" || !/^[A-Z]/.test(call.fn.name)) continue;
        const b = lookup(call.fn.name, fn, call.pos.offset, idx);
        if (b.kind === "class") out.constructions.set(b.cls, [...(out.constructions.get(b.cls) ?? []), { call, fn }]);
      }
    }
  }
  indexes.set(idx, out);
  return out;
}

/** A constructor parameter: the argument of the class's one construction. */
function param(p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (fn.name !== "<init>" || !fn.cls) return undefined;
  const sites = indexOf(ctx.idx).constructions.get(fn.cls) ?? [];
  const arg = sites.length === 1 ? argFor(sites[0]!.call, p) : undefined;
  return arg ? { expr: arg.value, fn: sites[0]!.fn } : undefined;
}

const PROVIDERS = new Set(["Provider", "FutureProvider", "StateProvider", "StreamProvider", "AutoDisposeProvider", "autoDispose", "family"]);

/** `ref.watch(p)` / `ref.read(p)` of a provider declared as `Provider((ref) => value)`: that value. */
function providerRead(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (call.fn.k !== "attr" || (call.fn.name !== "watch" && call.fn.name !== "read") || !call.args[0] || call.args[0].name) return undefined;
  const decl = deref(call.args[0].value, fn, ctx).expr;
  const path = decl.k === "call" ? dottedPath(decl.fn) : undefined;
  if (decl.k !== "call" || !path?.some((s) => PROVIDERS.has(s))) return undefined;
  const create = decl.args.find((a) => !a.name)?.value;
  return create?.k === "fnref" && create.fn.returns.length === 1 ? { expr: create.fn.returns[0]!, fn: create.fn } : undefined;
}

/** `getIt<Dio>()`, `GetIt.I<Dio>()`, `GetIt.instance.get<Dio>()`: the one registration of that type. */
function locatorGet(call: CallExpr, ctx: IrCtx): Scoped | undefined {
  const type = typeName(call.typeArgs?.[0]);
  if (!type || call.args.length > 0) return undefined;
  const found = indexOf(ctx.idx).registrations.get(type) ?? [];
  return found.length === 1 ? found[0] : undefined;
}

export const DART_INJECTION: IrInjection = {
  param,
  field: () => undefined,
  call: (call, fn, ctx) => providerRead(call, fn, ctx) ?? locatorGet(call, ctx),
};
