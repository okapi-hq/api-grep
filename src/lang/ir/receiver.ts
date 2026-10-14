import type { Chain } from "./chain.js";
import { valueChain } from "./chain.js";
import { evaluate } from "./evaluate.js";
import type { IrRegistryEntry } from "./language.js";
import { argFor, exprText, type CallExpr, type Expr, type FunctionDef, type Param } from "./model.js";
import { classMethod, type ProjectIndex } from "./project.js";
import { withSubst, type IrCtx, type IrRaw, type Seg, type Subst } from "./raw.js";
import { detectSdk } from "./sdk.js";

/** Callers looked at per function, and distinct clients reported per call: bounds on hostile input. */
const MAX_CALLERS = 50;
const MAX_CLIENTS = 4;

export interface ReceiverResult {
  raws: IrRaw[];
  /** No caller passes a known client and the manifests name no single SDK with the method. */
  unknown: boolean;
}

type Detect = (call: CallExpr, fn: FunctionDef, ctx: IrCtx) => { raw?: IrRaw };

interface Caller {
  call: CallExpr;
  fn: FunctionDef;
}

const CALLERS = new WeakMap<ProjectIndex, Map<FunctionDef, Caller[]>>();
const RESULTS = new WeakMap<CallExpr, ReceiverResult>();

const isConstructor = (fn: FunctionDef): boolean => !!fn.cls && (fn.name === "__init__" || fn.name === "__construct");

/**
 * The method key after an untyped parameter (`client.messages.create(...)`: `messages.create`), when a registry has it.
 * One member (`session.post(url)`) is an HTTP client's verb, listed as `injected-client` instead.
 */
function receiverKey(chain: Chain, call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  if (chain.root.kind !== "param" || !chain.root.param) return undefined;
  if (chain.segs.length === 0) return sendsBuiltDocument(call, fn, ctx) ? "()" : undefined;
  if (chain.segs.length < 2) return undefined;
  if (chain.segs[chain.segs.length - 1]!.call !== call) return undefined;
  const key = chain.segs.map((s) => s.name).join(".");
  return ctx.idx.lang.registry.some((e) => Object.hasOwn(e.methods, key)) ? key : undefined;
}

/**
 * `endpoint(op)` (#83): a parameter called with a document the library builds as an object (sgqlc's `Operation`) is
 * an endpoint called directly (the `()` key); called with anything else it is just a callback.
 */
function sendsBuiltDocument(call: CallExpr, fn: FunctionDef, ctx: IrCtx): boolean {
  const lang = ctx.idx.lang;
  if (!lang.documentOf) return false;
  return lang.registry.some((e) => {
    const spec = Object.hasOwn(e.methods, "()") ? e.methods["()"] : undefined;
    if (spec?.documentArg === undefined) return false;
    const arg = call.args.find((a) => a.name === (spec.documentKw ?? "document")) ?? call.args.filter((a) => !a.name && !a.spread)[spec.documentArg];
    return !!arg && lang.documentOf!({ expr: arg.value, fn }, ctx) !== undefined;
  });
}

function lastName(e: Expr): string | undefined {
  if (e.k === "name" || e.k === "attr") return e.name;
  return e.k === "qname" ? e.path[e.path.length - 1] : undefined;
}

/** Whether a call runs `target`: the function or method itself, or the class whose constructor it is. */
function runs(call: CallExpr, fn: FunctionDef, target: FunctionDef, ctx: IrCtx): boolean {
  const c = valueChain(call.fn, fn, ctx);
  if (c.segs.length > 0) return false;
  if (c.root.kind === "function") return c.root.fn === target;
  if (c.root.kind !== "class" || !isConstructor(target)) return false;
  return (classMethod(c.root.cls, "__init__", ctx.idx) ?? classMethod(c.root.cls, "__construct", ctx.idx)) === target;
}

/** The project's calls to `target` (its class, for a constructor), filtered by name before anything is resolved. */
function callersOf(target: FunctionDef, ctx: IrCtx): Caller[] {
  let memo = CALLERS.get(ctx.idx);
  if (!memo) CALLERS.set(ctx.idx, (memo = new Map<FunctionDef, Caller[]>()));
  const hit = memo.get(target);
  if (hit) return hit;
  const name = isConstructor(target) ? target.cls!.name : target.name;
  const out: Caller[] = [];
  for (const mod of ctx.idx.all()) {
    for (const fn of mod.allFunctions) {
      for (const call of fn.calls) if (out.length < MAX_CALLERS && lastName(call.fn) === name && runs(call, fn, target, ctx)) out.push({ call, fn });
    }
  }
  memo.set(target, out);
  return out;
}

/** What tells two clients apart: the registry entry and the base URL the code gives it. */
function clientKey(raw: IrRaw, ctx: IrCtx): string {
  const base = raw.baseUrl ? JSON.stringify(evaluate(raw.baseUrl.expr, raw.baseUrl.fn, ctx)) : "";
  return `${ctx.idx.lang.registry.indexOf(raw.sdk!.entry)}|${base}`;
}

/** The call with the parameter bound to what each caller passes; one raw per distinct client. */
function fromCallers(call: CallExpr, fn: FunctionDef, param: Param, owner: FunctionDef, ctx: IrCtx, detect: Detect): IrRaw[] {
  const out = new Map<string, IrRaw>();
  for (const caller of callersOf(owner, ctx)) {
    const arg = argFor(caller.call, param);
    if (!arg) continue;
    const subst: Subst = new Map([[param, { expr: arg.value, fn: caller.fn }]]);
    const raw = detect(call, fn, withSubst(ctx, subst)).raw;
    if (!raw?.sdk) continue;
    const key = clientKey(raw, ctx);
    if (!out.has(key)) out.set(key, { ...raw, subst, clientFrom: "caller" });
    if (out.size >= MAX_CLIENTS) break;
  }
  return [...out.values()];
}

/** The client a registry entry is reached through: its import root and its first constructor, as a declared type. */
function clientSegs(entry: IrRegistryEntry): Seg[] {
  const root: Seg[] = entry.imports[0]!.split(".").map((name) => ({ name }));
  const ctor = entry.instance?.names[0];
  if (!ctor) return root;
  const parts: Seg[] = ctor.split(".").map((name) => ({ name }));
  parts[parts.length - 1] = { ...parts[parts.length - 1]!, typed: true };
  return [...root, ...parts];
}

/**
 * The one SDK declared next to the file whose registry has the method. Entries of one package count once, its first
 * (the package's own client: `Anthropic` before `AnthropicBedrock`) is used.
 */
function fromManifest(key: string, chain: Chain, call: CallExpr, fn: FunctionDef, ctx: IrCtx): IrRaw | undefined {
  const declared = ctx.declared?.(fn.module.file);
  if (!declared || declared.size === 0) return undefined;
  const lang = ctx.idx.lang;
  const isDeclared = (e: IrRegistryEntry): boolean => [e.package, ...(e.aliases ?? [])].some((p) => declared.has(lang.normalizePackage(p)));
  const matches = lang.registry.filter((e) => Object.hasOwn(e.methods, key) && !e.callersOnly && isDeclared(e));
  if (new Set(matches.map((e) => e.package)).size !== 1) return undefined;
  const entry = matches[0]!;
  // `endpoint(op)`: the client itself is called
  const called: Seg[] = chain.segs.length > 0 ? chain.segs : [{ name: "()", call, fn }];
  const raw = detectSdk({ root: { kind: "external" }, segs: [...clientSegs(entry), ...called] }, call, fn, ctx);
  return raw?.sdk?.entry.package === entry.package ? { ...raw, clientFrom: "manifest" } : undefined;
}

/**
 * An SDK method called on an untyped parameter (`def ask(client, prompt): client.messages.create(...)`): the clients
 * the function's callers pass, one level up; else the one SDK the manifests declare with that method; else unknown.
 */
export function receiverCalls(call: CallExpr, fn: FunctionDef, chain: Chain, ctx: IrCtx, detect: Detect): ReceiverResult | undefined {
  const key = receiverKey(chain, call, fn, ctx);
  if (!key || chain.root.kind !== "param") return undefined;
  const cacheable = !ctx.subst || ctx.subst.size === 0;
  const cached = cacheable ? RESULTS.get(call) : undefined;
  if (cached) return cached;
  const { param, fn: owner } = chain.root;
  const raws = param && owner ? fromCallers(call, fn, param, owner, ctx, detect) : [];
  const manifest = raws.length === 0 ? fromManifest(key, chain, call, fn, ctx) : undefined;
  // a key only `callersOnly` registries have (`order.find`) is too common a name to be reported as an unfollowed client
  const guess = ctx.idx.lang.registry.some((e) => !e.callersOnly && Object.hasOwn(e.methods, key));
  const result: ReceiverResult = { raws: manifest ? [manifest] : raws, unknown: raws.length === 0 && !manifest && guess };
  if (cacheable) RESULTS.set(call, result);
  return result;
}

/** The callee as the diagnostic shows it. */
export function receiverExpr(call: CallExpr): string {
  return exprText(call.fn).replace(/\$/g, "").slice(0, 80);
}
