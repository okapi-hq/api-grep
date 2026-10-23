import { argAt } from "./args.js";
import type { IrRegistryEntry, Scoped } from "./language.js";
import { dottedPath, type CallExpr, type Expr, type FunctionDef } from "./model.js";
import type { ProjectIndex } from "./project.js";
import type { IrCtx } from "./raw.js";
import { deref } from "./values.js";

/**
 * SDKs configured once, away from their calls: `PostHog.setup(PostHogConfig(apiKey, host = h))` at startup, then
 * `PostHog.capture(...)` anywhere. The host is the one setup call of the project gives; several different ones (or
 * none) leave the registry's host.
 */

const memo = new WeakMap<ProjectIndex, Map<IrRegistryEntry, Scoped | null>>();

const endsWith = (path: string[], name: string): boolean => {
  const parts = name.split(".");
  return path.length >= parts.length && parts.every((p, i) => path[path.length - parts.length + i] === p);
};

/** A callee's dotted name, through calls: Dart's `Posthog().setup` (a singleton's factory) is `Posthog.setup`. */
function calleePath(e: Expr): string[] | undefined {
  if (e.k === "call") return calleePath(e.fn);
  if (e.k !== "attr") return dottedPath(e);
  const head = calleePath(e.obj);
  return head ? [...head, e.name] : undefined;
}

/**
 * `set:<name>`: the last value the code sets on the config's member, by a Dart cascade on its construction
 * (`PostHogConfig(k)..host = h`) or on the variable holding it (`config.host = h`).
 */
function memberSet(config: { expr: CallExpr; fn: FunctionDef }, ref: Expr | undefined, name: string): Scoped | undefined {
  const cascaded = config.expr.sets?.filter((s) => s.name === name).at(-1);
  if (cascaded) return { expr: cascaded.value, fn: config.fn };
  const target = ref?.k === "name" ? ref.name : undefined;
  const set = target ? config.fn.attrSets?.filter((s) => s.target === target && s.name === name).at(-1) : undefined;
  return set ? { expr: set.value, fn: config.fn } : undefined;
}

/** Every value at `place` of the project's calls named like `calls` (of their config argument `arg`, when given). */
function setupValues(calls: string[], arg: number | undefined, place: string, ctx: IrCtx): Scoped[] {
  const found: Scoped[] = [];
  for (const mod of ctx.idx.all()) {
    for (const fn of mod.allFunctions) {
      for (const call of fn.calls) {
        const path = calleePath(call.fn);
        if (!path || !calls.some((c) => endsWith(path, c))) continue;
        const positional = call.args.filter((a) => !a.name && !a.spread);
        const at = arg === undefined ? undefined : positional[arg < 0 ? positional.length + arg : arg];
        const config = arg === undefined ? { expr: call, fn } : at ? deref(at.value, fn, ctx) : undefined;
        if (config?.expr.k !== "call") continue;
        const built = { expr: config.expr, fn: config.fn };
        const value = place.startsWith("set:") ? memberSet(built, at?.value, place.slice(4)) : argAt({ name: "config", call: built.expr, fn: built.fn }, place, ctx);
        if (value) found.push(value);
      }
    }
  }
  return found;
}

function find(entry: IrRegistryEntry, ctx: IrCtx): Scoped | undefined {
  const spec = entry.setupUrl!;
  const found = setupValues(spec.calls, spec.arg, spec.host, ctx);
  return found.length === 1 ? found[0] : undefined;
}

/** The base URL of an entry with `setupUrl`, from the project's setup call. */
export function setupBaseUrl(entry: IrRegistryEntry, ctx: IrCtx): Scoped | undefined {
  if (!entry.setupUrl) return undefined;
  let byEntry = memo.get(ctx.idx);
  if (!byEntry) memo.set(ctx.idx, (byEntry = new Map<IrRegistryEntry, Scoped | null>()));
  if (!byEntry.has(entry)) byEntry.set(entry, find(entry, ctx) ?? null);
  return byEntry.get(entry) ?? undefined;
}

const argMemo = new WeakMap<ProjectIndex, Map<string, Scoped | null>>();

/**
 * A setting the project gives once, at startup (`vertexai.init(project=p, location=l)`): the `params` source
 * `setup:<call>,<call>:<place>` (`setup:vertexai.init:kw:project`). Several calls, or none, give no value.
 */
export function setupArg(source: string, ctx: IrCtx): Scoped | undefined {
  const m = /^setup:([\w.,]+):(.+)$/.exec(source);
  if (!m) return undefined;
  let bySource = argMemo.get(ctx.idx);
  if (!bySource) argMemo.set(ctx.idx, (bySource = new Map<string, Scoped | null>()));
  if (!bySource.has(source)) {
    const found = setupValues(m[1]!.split(","), undefined, m[2]!, ctx);
    bySource.set(source, found.length === 1 ? found[0]! : null);
  }
  return bySource.get(source) ?? undefined;
}
