import type { Chain } from "./chain.js";
import { argAt, argOf, kwargsDict, propOf } from "./args.js";
import type { IrMethodSpec, IrRegistryEntry, Scoped } from "./language.js";
import type { CallExpr, Entry, Expr, FunctionDef } from "./model.js";
import { withAlternatives, type IrCtx, type IrRaw, type IrSdkMatch, type Seg } from "./raw.js";
import { deref, staticKey } from "./values.js";
import { lambdaValue } from "./builders.js";
import { irEndpoint, type IrEndpoint } from "./endpoint.js";
import { mcpServers } from "./mcp-servers.js";
import { recordBody } from "./record.js";
import { setupBaseUrl } from "./setup.js";

/** Keyword arguments that configure the SDK call itself rather than the request body. */
const TRANSPORT_KWARGS = new Set(["extra_headers", "extra_query", "extra_body", "timeout", "max_retries", "request_options", "idempotency_key", "api_key", "stripe_account", "stripe_version", "options"]);

/**
 * Settings of a model client (LangChain, LlamaIndex, smolagents...) that configure it rather than its requests: keys,
 * endpoints, transport, callbacks. What is left (model, temperature, max_tokens...) is what each request sends.
 */
const CLIENT_KWARGS = new Set([
  "api_key", "openai_api_key", "anthropic_api_key", "google_api_key", "groq_api_key", "mistral_api_key", "cohere_api_key", "together_api_key", "fireworks_api_key", "deepseek_api_key", "xai_api_key",
  "together_api_base", "fireworks_api_base",
  "base_url", "api_base", "openai_api_base", "anthropic_api_url", "endpoint", "endpoint_url", "azure_endpoint", "api_version", "openai_api_version", "azure_deployment", "deployment_name", "azure_ad_token", "azure_ad_token_provider",
  "organization", "openai_organization", "project", "location", "region_name", "credentials", "credentials_profile_name", "aws_access_key_id", "aws_secret_access_key", "aws_session_token", "client_options",
  "timeout", "request_timeout", "max_retries", "http_client", "http_async_client", "client", "async_client", "default_headers", "default_query", "transport",
  "streaming", "callbacks", "callback_manager", "verbose", "cache", "tags", "metadata", "rate_limiter", "disable_streaming", "model_kwargs", "provider",
  "response_model", "validation_context", "max_retries", "strict",
]);

const invoked = (s: Seg): boolean => !!s.call || !!s.typed;

/** Import roots split once per registry entry: every call of every scanned file is matched against them. */
const SPLIT_ROOTS = new WeakMap<string[], string[][]>();

function splitRoots(roots: string[]): string[][] {
  let out = SPLIT_ROOTS.get(roots);
  if (!out) SPLIT_ROOTS.set(roots, (out = roots.map((r) => r.split("."))));
  return out;
}

/**
 * Segments an import root covers (`google.genai` covers `[google, genai]`), the longest root first; -1 when none
 * does. A root that is a class constructed on the spot (`new \SendGrid($key)`) covers nothing: the class is the first
 * segment after it, the instance.
 */
export function rootLength(segs: Seg[], roots: string[]): number {
  let best = -1;
  let bestParts = 0;
  for (const parts of splitRoots(roots)) {
    if (parts.length <= bestParts || parts.length > segs.length || !parts.every((p, i) => segs[i]!.name === p)) continue;
    const open = parts.findIndex((_, i) => invoked(segs[i]!));
    if (open >= 0 && open < parts.length - 1) continue;
    best = open === parts.length - 1 ? parts.length - 1 : parts.length;
    bestParts = parts.length;
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

/**
 * `client` matches a `client(...)` segment after the import root or after other calls (`Session().client(...)`) or
 * typed instances (`slack.methods(token)` with `slack: Slack`); a
 * dotted name (`firestore.client`) also the segments before it. A plain name does not match deeper in a namespace:
 * `Client` is `Anthropic\Client`, not `Anthropic\Bedrock\Client`.
 */
export function namedAt(rel: Seg[], i: number, name: string): boolean {
  const parts = name.split(".");
  const from = i - (parts.length - 1);
  if (from < 0 || !parts.every((p, j) => rel[from + j]!.name === p)) return false;
  return rel.slice(0, from).every(invoked);
}

/** The constructor / factory segment: the last one named in `instance.names` before the method. */
export function instanceIndex(entry: IrRegistryEntry, rel: Seg[]): number {
  for (let i = rel.length - 2; i >= 0; i--) if (invoked(rel[i]!) && entry.instance?.names.some((n) => namedAt(rel, i, n))) return i;
  return -1;
}

/** A builder segment: named in `builders`, or starting with a `set*` prefix there. */
const isBuilder = (entry: IrRegistryEntry, name: string): boolean => (entry.builders ?? []).some((b) => (b.endsWith("*") ? name.startsWith(b.slice(0, -1)) : b === name));

/** After a builder instance (`S3Client.builder().region(r).build()`), the client is what its last `build()` returns. */
function builtIndex(entry: IrRegistryEntry, rel: Seg[], inst: number): number {
  const build = entry.instance?.build;
  if (!build || inst < 0) return inst;
  for (let i = rel.length - 2; i > inst; i--) if (rel[i]!.call && rel[i]!.name === build) return i;
  return inst;
}

function keyOf(entry: IrRegistryEntry, rel: Seg[], inst: number): string {
  const after = rel.slice(inst + 1);
  return after
    .filter((s, i) => i === after.length - 1 || !isBuilder(entry, s.name))
    .map((s) => s.name)
    .join(".");
}

function matchEntry(entry: IrRegistryEntry, segs: Seg[], ctx: IrCtx): IrSdkMatch | undefined {
  const n = rootLength(segs, entry.imports);
  if (n < 0 || n >= segs.length) return undefined;
  const rel = segs.slice(n);
  const inst = instanceIndex(entry, rel);
  if (inst >= 0 && !selected(entry, rel[inst]!, ctx)) return undefined;
  if (inst < 0 && entry.instance?.select) return undefined;
  const key = keyOf(entry, rel, builtIndex(entry, rel, inst));
  const spec = Object.hasOwn(entry.methods, key) ? entry.methods[key] : wildcardSpec(entry, key);
  return spec ? { entry, key, spec, segs: rel, method: rel[rel.length - 1]! } : undefined;
}

const wildcards = new WeakMap<IrRegistryEntry, [string[], IrMethodSpec][]>();

/** Key parts against a wildcard key's: `*` is one name (not one of `not`), `**` one or more of any. */
function fits(p: string[], parts: string[], not: string[]): boolean {
  const deep = p.indexOf("**");
  if (deep < 0) return p.length === parts.length && p.every((x, i) => (x === "*" ? !not.includes(parts[i]!) : x === parts[i]));
  const tail = p.length - deep - 1;
  if (parts.length <= deep + tail) return false;
  return fits(p.slice(0, deep), parts.slice(0, deep), not) && fits(p.slice(deep + 1), parts.slice(parts.length - tail), not);
}

/**
 * A key with a contract's function in it (`eth.contract.functions.*.call`, #78): `*` stands for one name; `**` for the
 * path segments of a fluent URL builder (sendgrid-python's `client.marketing.contacts.put`).
 */
function wildcardSpec(entry: IrRegistryEntry, key: string): IrMethodSpec | undefined {
  let list = wildcards.get(entry);
  if (!list) wildcards.set(entry, (list = Object.entries(entry.methods).flatMap(([k, s]) => (k.includes("*") ? [[k.split("."), s] as [string[], IrMethodSpec]] : []))));
  if (list.length === 0) return undefined;
  const parts = key.split(".");
  const not = entry.notFunctions ?? [];
  return list.find(([p]) => fits(p, parts, not))?.[1];
}

/** The base URL the code gives the client: an argument of a call named in `instance.urlArg`, or of the call itself. */
function codeBaseUrl(m: IrSdkMatch, ctx: IrCtx): Scoped | undefined {
  for (const kw of m.spec.baseUrlKw ?? []) {
    const own = argOf(m.method, undefined, kw);
    if (own) return own;
  }
  const urlArg = m.entry.instance?.urlArg;
  if (!urlArg) return undefined;
  // a call that builds the client may send a request of its own under that URL (A2A `create_client(url)`: the card)
  const before = m.spec.ownBaseUrl ? m.segs : m.segs.slice(0, -1);
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
    // `kw:stream`, `true:kw:stream`, `kw:table#.-1|arg:0#.-1`: each keyword a source reads
    for (const alt of source.split("|")) {
      const kw = /^(?:true:)?kw:(\w+)/.exec(alt);
      if (kw) out.add(kw[1]!);
    }
  }
  return out;
}

/** Fields from positional arguments of a chain call and from its setters (`Message.creator(to, from, body).setMediaUrl(u)`). */
function argFieldsBody(m: IrSdkMatch, spec: NonNullable<IrMethodSpec["argFields"]>, fn: FunctionDef): Scoped | undefined {
  const entries: Entry[] = [];
  const at = (seg: Seg, value: Expr): Expr => (seg.fn && seg.fn !== fn ? { k: "scoped", expr: value, fn: seg.fn } : value);
  const seg = [...m.segs].reverse().find((s) => s.call && s.name === spec.seg);
  const args = seg?.call?.args.filter((a) => !a.name && !a.spread) ?? [];
  spec.fields.forEach((field, i) => {
    if (field && args[i]) entries.push({ key: { k: "str", v: field }, value: at(seg!, args[i].value) });
  });
  const prefix = spec.setters;
  for (const s of prefix ? m.segs : []) {
    const value = s.call?.args.find((a) => !a.name && !a.spread)?.value;
    if (value && s.name.length > prefix!.length && s.name.startsWith(prefix!)) entries.push({ key: { k: "str", v: s.name.slice(prefix!.length) }, value: at(s, value) });
  }
  return entries.length > 0 ? { expr: { k: "dict", entries }, fn } : undefined;
}

/**
 * The fields named by `fieldArgs` from the positional arguments (`bot.send_message(chat_id, text)`), then the keyword
 * arguments (`parse_mode=...`) or the array at `bodyArg` (PHP).
 */
function fieldArgsDict(m: IrSdkMatch, call: CallExpr): Expr | undefined {
  const entries: Entry[] = [];
  const positional = call.args.filter((a) => !a.name && !a.spread);
  m.spec.fieldArgs!.forEach((field, i) => {
    if (field && positional[i]) entries.push({ key: { k: "str", v: field }, value: positional[i].value });
  });
  const kw = m.spec.bodyKwargs || m.spec.queryKwargs ? kwargsDict(call, pathKwargs(m)) : undefined;
  if (kw?.k === "dict") entries.push(...kw.entries);
  const options = m.spec.bodyArg !== undefined ? positional[m.spec.bodyArg] : undefined;
  if (options) entries.push({ value: options.value, spread: true });
  return entries.length > 0 ? { k: "dict", entries } : undefined;
}

function bodyOf(m: IrSdkMatch, call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const spec = m.spec;
  if (spec.fieldArgs) {
    const dict = spec.queryKwargs ? undefined : fieldArgsDict(m, call);
    return dict ? { expr: dict, fn } : undefined;
  }
  if (spec.argFields) return argFieldsBody(m, spec.argFields, fn);
  if (spec.bodyAt) return placeAt(m, spec.bodyAt, ctx);
  if (spec.bodySelf) return { expr: call, fn };
  // a record sends the attributes it is built with and those set on it (`product.title = t; product.save()`, #92, #102)
  if (spec.record?.body) return recordBody(m, ctx);
  if (spec.bodyKw) {
    const arg = argOf(m.method, spec.bodyArg, spec.bodyKw);
    return spec.bodyProp ? propOf(arg, spec.bodyProp, ctx) : arg;
  }
  if (spec.bodyKwargs) {
    const skip = pathKwargs(m);
    if (spec.clientKwargs) for (const k of CLIENT_KWARGS) skip.add(k);
    const dict = kwargsDict(call, skip);
    const positional = spec.bodyArg !== undefined ? argOf(m.method, spec.bodyArg) : undefined;
    return positional ?? (dict ? { expr: dict, fn } : undefined);
  }
  const arg = spec.bodyArg !== undefined ? argAt(m.method, String(spec.bodyArg), ctx) : undefined;
  // a lambda that fills the request's builder (`s3.getObject { it.bucket(b) }`) stands for what it sets
  const filled = arg && m.entry.setters ? lambdaValue(arg, m.entry.setters, ctx) : undefined;
  return spec.bodyProp ? propOf(filled ?? arg, spec.bodyProp, ctx) : (filled ?? arg);
}

/** A body built from a builder: its setters' arguments are inputs too (`builder.maxTokens(limit)` before `build()`). */
function builtBody(m: IrSdkMatch, body: Scoped | undefined, ctx: IrCtx): Scoped[] {
  if (!body || !m.entry.setters) return [];
  const d = deref(body.expr, body.fn, ctx);
  return d.expr.k === "dict" ? [d] : [];
}

/** A URL the client was built with (`WebhookClient(url).send(...)`): argument N of the instance; or one the method takes. */
function instanceUrl(m: IrSdkMatch): Scoped | undefined {
  if (m.spec.urlArg !== undefined) return argOf(m.method, m.spec.urlArg);
  if (m.spec.urlFromInstanceArg === undefined) return undefined;
  const i = instanceIndex(m.entry, m.segs);
  return i >= 0 ? argOf(m.segs[i], m.spec.urlFromInstanceArg) : undefined;
}

/**
 * Whether the method builds its request from the call's arguments. `capture_exception(err)` sends the same request
 * whatever `err` is, so a `report(err)` wrapper around it is not a client of its own.
 */
function readsArgs(spec: IrMethodSpec): boolean {
  const positions = [spec.bodyArg, spec.queryArg, spec.routeArg, spec.urlFromInstanceArg, spec.urlArg, spec.modelArg, spec.documentArg, ...(spec.pathArgs ?? [])];
  return positions.some((i) => i !== undefined) || !!spec.argFields || !!spec.fieldArgs || !!spec.bodyKw || !!spec.bodyKwargs || !!spec.queryKwargs || !!spec.modelKw || !!spec.modelAt || !!spec.bodyAt || Object.keys(spec.params ?? {}).length > 0;
}

/**
 * `modelAt` / `bodyAt`: a place of the method's arguments, or of the chain call it names (`ClaudeSDKClient:kw:options.model`,
 * `insert:kw:body` of `service.events().insert(body=e).execute()`); `|` tries each.
 */
function placeAt(m: IrSdkMatch, where: string, ctx: IrCtx): Scoped | undefined {
  for (const place of where.split("|")) {
    const named = /^([A-Za-z_]\w*):(.+)$/.exec(place);
    const segName = named && named[1] !== "kw" ? named[1] : undefined;
    const seg = segName ? [...m.segs].reverse().find((s) => !!s.call && s.name === segName) : m.method;
    const at = segName ? named![2]! : place;
    const hit = seg ? (argAt(seg, at, ctx) ?? optionsKeyword(seg, at, ctx)) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/** `kw:options.model` when the options are an object built with keywords (`ClaudeAgentOptions(model="...")`). */
function optionsKeyword(seg: Seg, at: string, ctx: IrCtx): Scoped | undefined {
  const m = /^(?:kw:(\w+)|(\d+))\.(\w+)$/.exec(at);
  const arg = m ? argOf(seg, m[2] !== undefined ? Number(m[2]) : undefined, m[1]) : undefined;
  const built = arg ? deref(arg.expr, arg.fn, ctx) : undefined;
  const kw = built?.expr.k === "call" ? built.expr.args.find((a) => a.name === m![3]) : undefined;
  return kw ? { expr: kw.value, fn: built!.fn } : undefined;
}

/** The model the method is given, else the one the client was built with (`modelSeg`). */
function modelOf(m: IrSdkMatch, ctx: IrCtx): Scoped | undefined {
  if (m.spec.modelAt) return placeAt(m, m.spec.modelAt, ctx);
  const own = m.spec.modelArg !== undefined || m.spec.modelKw ? argOf(m.method, m.spec.modelArg, m.spec.modelKw) : undefined;
  const seg = !own && m.spec.modelSeg ? [...m.segs.slice(0, -1)].reverse().find((s) => !!s.call && m.spec.modelSeg!.includes(s.name)) : undefined;
  return own ?? (seg ? argOf(seg, 0, "model") : undefined);
}

/** The file's manifests declare another package with the entry's class names (`sameClassesAs`) and not the entry's. */
function otherPackage(entry: IrRegistryEntry, fn: FunctionDef, ctx: IrCtx): boolean {
  if (!entry.sameClassesAs) return false;
  const declared = ctx.declared?.(fn.module.file);
  const has = (p: string): boolean => !!declared?.has(ctx.idx.lang.normalizePackage(p));
  return entry.sameClassesAs.some(has) && ![entry.package, ...(entry.aliases ?? [])].some(has);
}

/**
 * An SDK call: a chain from a registry's import root to one of its methods. After the first registry that reads it,
 * the agent frameworks' MCP registries add the servers the same call connects to (CrewAI's `Agent(mcps=[...])`), as
 * other requests of the call.
 */
export function detectSdk(chain: Chain, call: CallExpr, fn: FunctionDef, ctx: IrCtx): IrRaw | undefined {
  if (chain.root.kind !== "external" || chain.segs[chain.segs.length - 1]?.call !== call) return undefined;
  const found: IrRaw[] = [];
  for (const entry of ctx.idx.lang.registry) {
    if (found.length > 0 && !entry.endpoint?.agent) continue;
    const m = matchEntry(entry, chain.segs, ctx);
    // a property read matches a property entry, a call a method: `w3.eth.get_balance` handed over is no request
    if (!m || !!m.spec.property !== !!call.property || otherPackage(entry, fn, ctx)) continue;
    found.push(...entryRaws(m, chain, call, fn, ctx));
  }
  const [first, ...rest] = found.flatMap(withAlternatives);
  return first && rest.length > 0 ? { ...first, alternatives: rest } : first;
}

/** The calls a matched method makes: one, or one per HTTP server of an agent framework's MCP client (none without one). */
function entryRaws(m: IrSdkMatch, chain: Chain, call: CallExpr, fn: FunctionDef, ctx: IrCtx): IrRaw[] {
  const entry = m.entry;
  const servers = entry.endpoint?.agent ? mcpServers(m, ctx) : undefined;
  const endpoint = servers ? undefined : entry.endpoint ? irEndpoint(m, ctx) : undefined;
  if (endpoint === null) return [];
  return (servers ?? [endpoint]).flatMap((ep) => {
    const raw = sdkRaw(m, call, fn, ep, ctx);
    const refined = ctx.idx.lang.refineSdk ? ctx.idx.lang.refineSdk(raw, chain, ctx) : raw;
    return refined ? [refined] : [];
  });
}

function sdkRaw(m: IrSdkMatch, call: CallExpr, fn: FunctionDef, endpoint: IrEndpoint | undefined, ctx: IrCtx): IrRaw {
  const body = bodyOf(m, call, fn, ctx);
  const query = m.spec.queryKwargs ? (m.spec.fieldArgs ? fieldArgsDict(m, call) : kwargsDict(call, pathKwargs(m))) : undefined;
  const baseUrl = endpoint ? endpoint.url : codeBaseUrl(m, ctx);
  const headers = [endpoint?.headers, m.spec.headersArg !== undefined ? argOf(m.method, m.spec.headersArg, "headers") : undefined].filter((h): h is Scoped => !!h);
  const args = m.segs.flatMap((s) => (s.call && s.fn ? s.call.args.map((a) => ({ expr: a.value, fn: s.fn! })) : []));
  return {
    call,
    fn,
    client: "sdk",
    sdk: m,
    url: instanceUrl(m),
    body,
    query: query ? { expr: query, fn } : m.spec.queryArg !== undefined ? argOf(m.method, m.spec.queryArg, m.spec.queryKw) : undefined,
    // a host set once at startup (`PostHog.setup(...)`) is not an input of the call: it is not a wrapper parameter
    baseUrl: baseUrl ?? setupBaseUrl(m.entry, ctx),
    baseRef: endpoint?.path,
    headers,
    inputs: [...(readsArgs(m.spec) ? args : []), ...builtBody(m, body, ctx), ...(baseUrl ? [baseUrl] : [])],
    model: modelOf(m, ctx),
    mcpTransport: endpoint?.transport ?? (endpoint?.transportFromUrl ? "url" : undefined),
  };
}
