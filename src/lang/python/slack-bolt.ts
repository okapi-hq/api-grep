import { valueChain } from "../ir/chain.js";
import type { IrMethodSpec, IrRegistryEntry, Scoped } from "../ir/language.js";
import type { Expr, FunctionDef, Param } from "../ir/model.js";
import type { IrCtx } from "../ir/raw.js";
import { namedAt, rootLength } from "../ir/sdk.js";
import bolt from "./registry/slack-bolt.json" with { type: "json" };
import slackSdk from "./registry/slack-sdk.json" with { type: "json" };

const webMethods = Object.entries(slackSdk.methods as Record<string, IrMethodSpec>).filter(([, spec]) => !spec.host);

/** slack-bolt: its own methods (`say`, `respond`) and slack-sdk's `WebClient` methods as `client.<method>` (`app.client`). */
export const SLACK_BOLT = {
  ...bolt,
  methods: { ...Object.fromEntries(webMethods.map(([key, spec]) => [`client.${key}`, spec])), ...bolt.methods },
} as unknown as IrRegistryEntry;

/**
 * Listener arguments bolt injects by name (`slack_bolt.kwargs_injection`), as members of the app: `client`, `say`,
 * `respond`; `context` and `args` give those members too (`context.client`, `context["client"]`), so they read as the app.
 */
const INJECTED: Record<string, string | undefined> = { client: "client", say: "say", respond: "respond", context: undefined, args: undefined };

/** `App(...)` / `AsyncApp(...)` of slack_bolt, constructed or typed (`app: App`). */
function isApp(e: Expr, fn: FunctionDef, ctx: IrCtx): boolean {
  const c = valueChain(e, fn, ctx);
  const n = c.root.kind === "external" ? rootLength(c.segs, SLACK_BOLT.imports) : -1;
  const rel = n >= 0 ? c.segs.slice(n) : [];
  const last = rel.at(-1);
  return !!last && (!!last.call || !!last.typed) && SLACK_BOLT.instance!.names.some((name) => namedAt(rel, rel.length - 1, name));
}

/** A parameter of a function decorated as a listener of a bolt app (`@app.event("app_mention")`, `@app.command(...)`). */
export function boltListenerParam(p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  if (!Object.hasOwn(INJECTED, p.name) || p.default || p.kind !== "normal") return undefined;
  // decorators are written in the enclosing scope
  const scope = fn.parent ?? fn.module.top;
  const app = fn.annotations?.find((a) => a.type.k === "attr" && isApp(a.type.obj, scope, ctx))?.type;
  if (app?.k !== "attr") return undefined;
  const member = INJECTED[p.name];
  return { expr: member ? { k: "attr", obj: app.obj, name: member, pos: app.pos } : app.obj, fn: scope };
}
