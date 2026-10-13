import { argAt } from "./args.js";
import type { IrRegistryEntry, Scoped } from "./language.js";
import { dottedPath } from "./model.js";
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

function find(entry: IrRegistryEntry, ctx: IrCtx): Scoped | undefined {
  const spec = entry.setupUrl!;
  const found: Scoped[] = [];
  for (const mod of ctx.idx.all()) {
    for (const fn of mod.allFunctions) {
      for (const call of fn.calls) {
        const path = dottedPath(call.fn);
        if (!path || !spec.calls.some((c) => endsWith(path, c))) continue;
        const positional = call.args.filter((a) => !a.name && !a.spread);
        const arg = positional[spec.arg < 0 ? positional.length + spec.arg : spec.arg];
        const config = arg ? deref(arg.value, fn, ctx) : undefined;
        if (config?.expr.k !== "call") continue;
        const host = argAt({ name: "config", call: config.expr, fn: config.fn }, spec.host, ctx);
        if (host) found.push(host);
      }
    }
  }
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
