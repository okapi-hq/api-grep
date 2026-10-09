import type { Chain } from "./chain.js";
import { argAt, argOf, kwargsDict, propOf } from "./args.js";
import type { IrRegistryEntry, Scoped } from "./language.js";
import type { CallExpr, FunctionDef } from "./model.js";
import type { IrCtx, IrRaw, IrSdkMatch, Seg } from "./raw.js";
import { staticKey } from "./values.js";

/** Keyword arguments that configure the SDK call itself rather than the request body. */
const TRANSPORT_KWARGS = new Set(["extra_headers", "extra_query", "extra_body", "timeout", "max_retries", "request_options", "idempotency_key", "api_key", "stripe_account", "stripe_version", "options"]);

const invoked = (s: Seg): boolean => !!s.call || !!s.typed;

/** Segments an import root covers (`google.genai` covers `[google, genai]`), the longest root first. */
export function rootLength(segs: Seg[], roots: string[]): number {
  let best = 0;
  for (const root of roots) {
    const parts = root.split(".");
    if (parts.length <= best || parts.length > segs.length) continue;
    if (parts.every((p, i) => segs[i]!.name === p && !invoked(segs[i]!))) best = parts.length;
  }
  return best;
}

function selected(entry: IrRegistryEntry, seg: Seg, ctx: IrCtx): boolean {
  const sel = entry.instance?.select;
  if (!sel) return true;
  const arg = argOf(seg, sel.arg, sel.kw);
  const value = arg ? staticKey(arg.expr, arg.fn, ctx) : undefined;
  return value !== undefined && sel.equals.includes(value);
}

/** `client` matches a `client(...)` segment; a dotted name (`firestore.client`) also the segments before it. */
function namedAt(rel: Seg[], i: number, name: string): boolean {
  const parts = name.split(".");
  if (parts.length > i + 1) return false;
  return parts.every((p, j) => rel[i - (parts.length - 1) + j]!.name === p);
}

/** The constructor / factory segment: the last one named in `instance.names` before the method. */
export function instanceIndex(entry: IrRegistryEntry, rel: Seg[]): number {
  for (let i = rel.length - 2; i >= 0; i--) if (invoked(rel[i]!) && entry.instance?.names.some((n) => namedAt(rel, i, n))) return i;
  return -1;
}

function keyOf(entry: IrRegistryEntry, rel: Seg[], inst: number): string {
  const after = rel.slice(inst + 1);
  const builders = new Set(entry.builders ?? []);
  return after
    .filter((s, i) => i === after.length - 1 || !builders.has(s.name))
    .map((s) => s.name)
    .join(".");
}

function matchEntry(entry: IrRegistryEntry, segs: Seg[], ctx: IrCtx): IrSdkMatch | undefined {
  const n = rootLength(segs, entry.imports);
  if (n === 0 || n >= segs.length) return undefined;
  const rel = segs.slice(n);
  const inst = instanceIndex(entry, rel);
  if (inst >= 0 && !selected(entry, rel[inst]!, ctx)) return undefined;
  if (inst < 0 && entry.instance?.select) return undefined;
  const key = keyOf(entry, rel, inst);
  const spec = entry.methods[key];
  return spec ? { entry, key, spec, segs: rel, method: rel[rel.length - 1]! } : undefined;
}

/** The base URL the code gives the client: an argument of a call named in `instance.urlArg`. */
function codeBaseUrl(m: IrSdkMatch, ctx: IrCtx): Scoped | undefined {
  const urlArg = m.entry.instance?.urlArg;
  if (!urlArg) return undefined;
  const before = m.segs.slice(0, -1);
  for (let i = 0; i < before.length; i++) {
    if (!before[i]!.call) continue;
    const where = Object.entries(urlArg).find(([name]) => namedAt(before, i, name))?.[1];
    const arg = where ? argAt(before[i], where, ctx) : undefined;
    if (arg) return arg;
  }
  return undefined;
}

/** Keyword arguments that fill path placeholders are not body properties. */
function pathKwargs(m: IrSdkMatch): Set<string> {
  const out = new Set(TRANSPORT_KWARGS);
  for (const [name, source] of Object.entries(m.spec.params ?? {})) {
    out.add(name);
    const kw = /^kw:(\w+)/.exec(source);
    if (kw) out.add(kw[1]!);
  }
  return out;
}

function bodyOf(m: IrSdkMatch, call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const spec = m.spec;
  if (spec.bodyKw) {
    const arg = argOf(m.method, spec.bodyArg, spec.bodyKw);
    return spec.bodyProp ? propOf(arg, spec.bodyProp, ctx) : arg;
  }
  if (spec.bodyKwargs) {
    const dict = kwargsDict(call, pathKwargs(m));
    const positional = spec.bodyArg !== undefined ? argOf(m.method, spec.bodyArg) : undefined;
    return positional ?? (dict ? { expr: dict, fn } : undefined);
  }
  const arg = spec.bodyArg !== undefined ? argAt(m.method, String(spec.bodyArg), ctx) : undefined;
  return spec.bodyProp ? propOf(arg, spec.bodyProp, ctx) : arg;
}

/** A URL the client was built with (`WebhookClient(url).send(...)`): argument N of the instance. */
function instanceUrl(m: IrSdkMatch): Scoped | undefined {
  if (m.spec.urlFromInstanceArg === undefined) return undefined;
  const i = instanceIndex(m.entry, m.segs);
  return i >= 0 ? argOf(m.segs[i], m.spec.urlFromInstanceArg) : undefined;
}

/** An SDK call: a chain from a registry's import root to one of its methods. */
export function detectSdk(chain: Chain, call: CallExpr, fn: FunctionDef, ctx: IrCtx): IrRaw | undefined {
  if (chain.root.kind !== "external" || chain.segs[chain.segs.length - 1]?.call !== call) return undefined;
  for (const entry of ctx.idx.lang.registry) {
    const m = matchEntry(entry, chain.segs, ctx);
    if (!m) continue;
    const body = bodyOf(m, call, fn, ctx);
    const query = m.spec.queryKwargs ? kwargsDict(call, pathKwargs(m)) : undefined;
    const baseUrl = codeBaseUrl(m, ctx);
    const args = m.segs.flatMap((s) => (s.call && s.fn ? s.call.args.map((a) => ({ expr: a.value, fn: s.fn! })) : []));
    return {
      call,
      fn,
      client: "sdk",
      sdk: m,
      url: instanceUrl(m),
      body,
      query: query ? { expr: query, fn } : m.spec.queryArg !== undefined ? argOf(m.method, m.spec.queryArg) : undefined,
      baseUrl,
      headers: [],
      inputs: [...args, ...(baseUrl ? [baseUrl] : [])],
    };
  }
  return undefined;
}
