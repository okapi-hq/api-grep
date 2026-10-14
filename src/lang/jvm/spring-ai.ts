import { valueChain, type Chain } from "../ir/chain.js";
import type { ConfiguredClient, IrRegistryEntry, Scoped } from "../ir/language.js";
import type { CallExpr, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, Seg } from "../ir/raw.js";
import { deref } from "../ir/values.js";
import { selected } from "./spring-ai-beans.js";
import { defaultModel, enumModel, springAiRelease } from "./spring-ai-models.js";
import { springProperty } from "./spring-config.js";

/**
 * Spring AI (#89): which provider a call through the shared interfaces is, and the model and base URL its
 * configuration gives (the registry is `registry/spring-ai.json`; the engine asks through `refineSdk`).
 */

type Configured = IrRegistryEntry & { configured: ConfiguredClient };

const familyCache = new WeakMap<IrRegistryEntry[], Configured[]>();

function familyOf(ctx: IrCtx): Configured[] {
  const registry = ctx.idx.lang.registry;
  let out = familyCache.get(registry);
  if (!out) familyCache.set(registry, (out = registry.filter((e): e is Configured => !!e.configured)));
  return out;
}

const under = (path: string, roots: string[]): boolean => roots.some((r) => path === r || path.startsWith(`${r}.`));
const pathOf = (c: Chain): string => c.segs.map((s) => s.name).join(".");
const positional = (call: CallExpr | undefined): Expr[] => call?.args.filter((a) => !a.name && !a.spread).map((a) => a.value) ?? [];

/** The model a `ChatClient` is made from (`ChatClient.create(model)`, `ChatClient.builder(model)`): its chain. */
function modelChain(chain: Chain, ctx: IrCtx): Chain {
  const i = chain.segs.findIndex((s, j) => !!s.call && (s.name === "create" || s.name === "builder") && chain.segs[j - 1]?.name === "ChatClient");
  const seg = i >= 0 ? chain.segs[i]! : undefined;
  const arg = positional(seg?.call)[0];
  return arg && seg?.fn ? valueChain(arg, seg.fn, ctx) : chain;
}

/** Of a provider's artifacts for one kind (the module first), the declared one; the module when none is and `any`. */
function picked(entry: Configured, family: Configured[], declared: Set<string>, any: boolean, ctx: IrCtx): boolean {
  const group = family.filter((e) => e.provider === entry.provider && e.configured.kind === entry.configured.kind);
  const hit = group.find((e) => declared.has(ctx.idx.lang.normalizePackage(e.package)));
  return hit ? hit === entry : any && group[0] === entry;
}

/**
 * Whether the entry is the provider of this chain: its own class, else the one provider of the family the build
 * declares with a model of this kind, else the one a qualifier, `spring.ai.model.<kind>` or a bean name selects.
 */
function applies(entry: Configured, model: Chain, raw: IrRaw, ctx: IrCtx): boolean {
  const fn = raw.fn;
  const family = familyOf(ctx).filter((e) => e.configured.family === entry.configured.family);
  const declared = ctx.declared?.(fn.module.file) ?? new Set<string>();
  const path = model.root.kind === "external" ? pathOf(model) : "";
  const owner = family.find((e) => under(path, e.configured.own));
  if (owner) return owner.provider === entry.provider && picked(entry, family, declared, true, ctx);
  const ofKind = family.filter((e) => e.configured.kind === entry.configured.kind && declared.has(ctx.idx.lang.normalizePackage(e.package)));
  const providers = new Set(ofKind.map((e) => e.provider));
  if (!providers.has(entry.provider) || !picked(entry, family, declared, false, ctx)) return false;
  if (providers.size === 1) return true;
  const confs = [...providers].map((p) => ofKind.find((e) => e.provider === p)!.configured);
  return selected(confs, raw.call.fn.k === "attr" ? raw.call.fn.obj : undefined, fn, ctx)?.id === entry.configured.id;
}

/** `X.builder().model(m)...`: the argument of its last `model(...)` setter; undefined when it sets none. */
function setterArg(e: Expr, names: Set<string>): Expr | undefined {
  for (let cur = e; cur.k === "call" && cur.fn.k === "attr"; cur = cur.fn.obj) {
    if (names.has(cur.fn.name) && positional(cur).length === 1) return positional(cur)[0];
  }
  return undefined;
}

const MODEL_SETTERS = new Set(["model", "withModel"]);

/** The model an options object sets, read where it is written; unknown when the object cannot be read. */
function optionsModel(s: Scoped, ctx: IrCtx): Scoped | undefined {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k !== "call") return { expr: { k: "attr", obj: d.expr, name: "model", pos: s.fn.pos }, fn: d.fn };
  const arg = setterArg(d.expr, MODEL_SETTERS);
  return arg ? { expr: arg, fn: d.fn } : undefined;
}

/** The last call of these names in the chain with an argument (`options(...)` of a prompt, `defaultOptions(...)` of a builder). */
function lastArg(segs: Seg[], names: string[]): Scoped | undefined {
  const seg = [...segs].reverse().find((s) => s.call && s.fn && names.includes(s.name) && positional(s.call).length > 0);
  return seg ? { expr: positional(seg.call)[0]!, fn: seg.fn! } : undefined;
}

/** `chatModel.call(new Prompt(text, options))`, `embed(new EmbeddingRequest(texts, options))`: the request's options. */
function requestOptions(raw: IrRaw, ctx: IrCtx): Scoped | undefined {
  const arg = positional(raw.sdk!.method.call)[0];
  if (!arg) return undefined;
  const d = deref(arg, raw.fn, ctx);
  const name = d.expr.k === "call" && (d.expr.fn.k === "name" || d.expr.fn.k === "attr") ? d.expr.fn.name : "";
  const args = d.expr.k === "call" && /^[A-Z]/.test(name) ? positional(d.expr) : [];
  return args.length >= 2 ? { expr: args[1]!, fn: d.fn } : undefined;
}

/** The model the code sets: the request's options, the prompt's `options(...)`, the client's or model's default options. */
function codeModel(raw: IrRaw, chain: Chain, model: Chain, ctx: IrCtx): Scoped | undefined {
  const options = requestOptions(raw, ctx) ?? lastArg(chain.segs, ["options"]) ?? lastArg([...model.segs, ...chain.segs], ["defaultOptions"]);
  return options ? optionsModel(options, ctx) : undefined;
}

/** A model class of the provider built here (`OpenAiChatModel.builder()...build()`, `new OllamaChatModel(api, ...)`): the starter's properties do not apply. */
function builtHere(model: Chain, conf: ConfiguredClient): boolean {
  return model.segs.some((s, i) => !!s.call && (conf.classes.includes(s.name) || (s.name === "builder" && conf.classes.includes(model.segs[i - 1]?.name ?? ""))));
}

/** The base URL of the API object a model built here gets (`openAiApi(OpenAiApi.builder().baseUrl(u).build())`). */
function builtBaseUrl(model: Chain, ctx: IrCtx): Scoped | undefined {
  const api = model.segs.find((s) => s.call && s.fn && /Api$/.test(s.name) && /^[a-z]/.test(s.name) && positional(s.call).length === 1);
  const ctor = model.segs.find((s) => s.call && s.fn && /^[A-Z]/.test(s.name) && positional(s.call).length > 0);
  const given = api ?? ctor;
  const value = given ? positional(given.call)[0] : undefined;
  if (!value || !given?.fn) return undefined;
  const d = deref(value, given.fn, ctx);
  const base = setterArg(d.expr, new Set(["baseUrl"]));
  // an API object the code gives but that cannot be read may point anywhere: its host is unknown
  return { expr: base ?? { k: "attr", obj: d.expr, name: "baseUrl", pos: given.fn.pos }, fn: d.fn };
}

/**
 * `https://gateway.example.com/v1` (also as a placeholder's default): Spring AI 2's OpenAI base URL ends with the
 * version, 1's does not; the paths of the registry start with `/v1`.
 */
const withoutV1 = (text: string): string => text.replace(/\/v1\/?(?=\}?$)/, "");

/** The first of these properties the module's configuration sets, read where the call is (it names no local). */
function configured(keys: string[], fn: FunctionDef, ctx: IrCtx, edit?: (t: string) => string): Scoped | undefined {
  if (!ctx.rootDir) return undefined;
  for (const key of keys) {
    const expr = springProperty(fn.module.file, ctx.rootDir, key, edit);
    if (expr) return { expr, fn };
  }
  return undefined;
}

/** `bedrock-runtime.{region}.amazonaws.com` with the region the configuration sets. */
function regional(entry: IrRegistryEntry, conf: ConfiguredClient, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const region = conf.region ? configured([conf.region], fn, ctx) : undefined;
  const [before, after] = entry.host.split("{region}");
  if (!region || after === undefined) return undefined;
  return { expr: { k: "tmpl", parts: [{ k: "str", v: `https://${before}` }, region.expr, { k: "str", v: after }] }, fn };
}

/** The model the code or the configuration sets, else the starter's default for the release the build declares. */
function modelOf(raw: IrRaw, chain: Chain, model: Chain, here: boolean, ctx: IrCtx): Scoped | undefined {
  const entry = raw.sdk!.entry;
  const conf = entry.configured!;
  const release = springAiRelease(entry, raw.fn, ctx);
  const code = codeModel(raw, chain, model, ctx);
  if (code) return enumModel(code, release, ctx) ?? code;
  if (here) return undefined;
  return configured(conf.model, raw.fn, ctx) ?? defaultModel(conf, release, raw.fn);
}

/** The JVM's `refineSdk`: Spring AI entries apply to their provider only, with the configured model and base URL. */
export function refineConfigured(raw: IrRaw, chain: Chain, ctx: IrCtx): IrRaw | undefined {
  const entry = raw.sdk?.entry;
  if (!entry?.configured) return raw;
  const conf = entry.configured;
  const model = modelChain(chain, ctx);
  if (!applies(entry as Configured, model, raw, ctx)) return undefined;
  // Google GenAI with a project goes to Vertex AI: another host and path, not read
  if (conf.elsewhereIf && configured([conf.elsewhereIf], raw.fn, ctx)) return undefined;
  const here = builtHere(model, conf);
  const edit = raw.sdk!.spec.path.startsWith("/v1/") ? withoutV1 : undefined;
  const baseUrl = here ? builtBaseUrl(model, ctx) : (configured(conf.baseUrl, raw.fn, ctx, edit) ?? regional(entry, conf, raw.fn, ctx));
  return { ...raw, model: raw.model ?? modelOf(raw, chain, model, here, ctx), baseUrl: raw.baseUrl ?? baseUrl };
}
