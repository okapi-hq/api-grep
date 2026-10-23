import { Node, type CallExpression, type Expression, type Identifier, type NewExpression } from "ts-morph";
import { guardedValue } from "../ast/expr.js";
import { getProp, toArrayLiteral } from "../ast/object.js";
import { identifierOrigin } from "../ast/origin.js";
import type { AuthScheme, Callee, RawCall } from "../types.js";
import { optionsModels, resolveModels, type AiSdkProvider, type Model, type ModelKit, type Models } from "./ai-sdk-model.js";
import { describeCallee, exportedChain } from "./callee.js";
import data from "./registry/genkit.json" with { type: "json" };

interface Plugin extends AiSdkProvider {
  export: string;
  prefix: string;
  default?: boolean;
  functions?: string[];
  constants?: Record<string, string>;
  embedContentModels?: string;
  /** Models sent elsewhere than the generate path, by name: `[pattern, path]`, the first match. */
  modelPaths?: [string, string][];
}

type Kind = "generate" | "stream" | "embed";

const PLUGINS = data.plugins as unknown as Plugin[];
const PACKAGES = new Set(data.packages);
const FACTORIES = new Set(data.factories);
const SITES = new Map(Object.entries(data.sites) as [string, Kind][]);
/** Plugin packages whose models the Genkit detector reads (they count as supported in the coverage report). */
export const GENKIT_PACKAGES = new Set(PLUGINS.map((p) => p.package));

const UNKNOWN: AiSdkProvider = { package: "genkit", provider: "unknown", host: "{provider}", auth: "unknown", paths: {} };

/** The plugin a call of a plugin package is: `googleAI(...)`, `googleAI.model(...)`, a default import, a legacy `gemini(...)`. */
function pluginOf(c: Callee): { plugin: Plugin; member: string } | undefined {
  const chain = exportedChain(c);
  for (const plugin of PLUGINS) {
    if (plugin.package !== c.package) continue;
    if (chain[0] === plugin.export) return { plugin, member: chain.slice(1).join(".") };
    if (plugin.default && c.importedName === "default") return { plugin, member: chain.join(".") };
    if (chain.length === 1 && plugin.functions?.includes(chain[0]!)) return { plugin, member: "model" };
  }
  return undefined;
}

/** `"googleai/gemini-2.5-flash"`: the plugin its prefix names, one the instance configures first. */
function namedPlugin(u: Expression, configured: Plugin[]): Plugin | undefined {
  const text = Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) ? u.getLiteralText() : Node.isTemplateExpression(u) ? u.getHead().getLiteralText() : "";
  const slash = text.indexOf("/");
  if (slash <= 0) return undefined;
  const prefix = text.slice(0, slash);
  return configured.find((p) => p.prefix === prefix) ?? PLUGINS.find((p) => p.prefix === prefix);
}

/** Genkit's model references; `configured` are the plugins of the instance, which a string's prefix picks among. */
function genkitKit(configured: Plugin[]): ModelKit {
  return {
    string: (u) => {
      const plugin = namedPlugin(u, configured);
      return [plugin ? { entry: plugin, member: "named", modelId: u } : { entry: UNKNOWN, member: "", modelId: u }];
    },
    factory: (u: CallExpression, c: Callee): Models => {
      const found = pluginOf(c);
      return found && (found.member === "model" || found.member === "embedder") ? [{ entry: found.plugin, member: found.member, modelId: u.getArguments()[0] as Expression | undefined }] : undefined;
    },
    imported: (id: Identifier): Models => {
      const origin = identifierOrigin(id);
      if (origin.kind !== "package") return undefined;
      const plugin = PLUGINS.find((p) => p.package === origin.package && p.constants?.[origin.importedName]);
      return plugin ? [{ entry: plugin, member: "constant", name: plugin.constants![origin.importedName] }] : undefined;
    },
  };
}

/** The known plugins of `genkit({ plugins: [googleAI()] })`; undefined when one of them is not known or not read. */
function configuredPlugins(options: Expression | undefined): Plugin[] | undefined {
  const list = toArrayLiteral(getProp(options, "plugins"));
  if (!list) return undefined;
  const out: Plugin[] = [];
  for (const el of list.getElements()) {
    const u = guardedValue(el);
    const found = Node.isCallExpression(u) ? pluginOf(describeCallee(u)) : undefined;
    if (!found || found.member !== "") return undefined;
    out.push(found.plugin);
  }
  return out;
}

/** `ai.generate(...)` on `ai = genkit({ ... })`: the request it sends and the instance's options. */
function genkitSite(node: CallExpression | NewExpression, callee: Callee): { kind: Kind; fn: string; instance?: Expression } | undefined {
  const inst = callee.instance;
  if (!Node.isCallExpression(node) || !callee.package || !PACKAGES.has(callee.package) || inst?.kind !== "call") return undefined;
  if (!FACTORIES.has(inst.chain.join(".")) || callee.chain.length !== 1) return undefined;
  const kind = SITES.get(callee.chain[0]!);
  return kind ? { kind, fn: callee.chain[0]!, instance: inst.args[0] } : undefined;
}

/**
 * `ai.generate({ model: googleAI.model("gemini-2.5-pro") })` and friends: one request to the model's provider, the
 * instance's default model when the call names none. A model picked at run time among several is one request each, as
 * for the AI SDK. With no model read, the one plugin the instance configures still names the endpoint; else the
 * provider is unknown.
 */
export function detectGenkit(node: CallExpression | NewExpression, callee: Callee): RawCall | null {
  const site = genkitSite(node, callee);
  if (!site) return null;
  const configured = configuredPlugins(site.instance);
  const kit = genkitKit(configured ?? []);
  const options = node.getArguments()[0] as Expression | undefined;
  const key = site.kind === "embed" ? "embedder" : "model";
  // the instance's default model, for a call that names none (a model it names but the scan cannot read is unknown)
  const fallback = site.kind !== "embed" && !getProp(options, key) ? getProp(site.instance, "model") : undefined;
  const models = optionsModels(options, kit, key) ?? (fallback ? resolveModels(fallback, 0, kit) : undefined);
  const lone = configured?.length === 1 ? configured[0] : undefined;
  const found: Model[] = models && models.length > 0 ? models : [{ entry: lone ?? UNKNOWN, member: "" }];
  const [first, ...rest] = found.map((m) => modelCall(node, site.kind, site.fn, m));
  return rest.length > 0 ? { ...first!, alternatives: rest } : first!;
}

/** The model name written in the code (without a string's plugin prefix), when it is a literal. */
function literalId(model: Model): string | undefined {
  const e = model.modelId;
  const literal = model.name ?? (e && (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) ? e.getLiteralText() : undefined);
  return model.member === "named" ? literal?.slice(literal.indexOf("/") + 1) : literal;
}

function pathOf(entry: Plugin | AiSdkProvider, kind: Kind, model: Model): string {
  const plugin = entry as Plugin;
  const id = literalId(model);
  const matches = (pattern: string | undefined): boolean => pattern !== undefined && id !== undefined && new RegExp(pattern).test(id);
  const own = kind === "embed" ? undefined : plugin.modelPaths?.find(([pattern]) => matches(pattern))?.[1];
  const path = own ?? (kind === "embed" && matches(plugin.embedContentModels) ? entry.paths.embedContent : entry.paths[kind]) ?? "/";
  return model.name ? path.replace("{model}", encodeURIComponent(model.name)) : path;
}

function modelCall(node: CallExpression | NewExpression, kind: Kind, fn: string, model: Model): RawCall {
  const { entry } = model;
  const path = pathOf(entry, kind, model);
  // `"googleai/gemini-2.5-flash"` sends the name after the plugin's prefix, in the path, where the model fact reads it
  const named = model.member === "named";
  const fromPath = named && entry !== UNKNOWN && path.includes("{model}");
  return {
    node,
    client: "sdk",
    sdk: {
      package: entry.package,
      provider: entry.provider,
      host: entry.host,
      chain: fn,
      spec: { method: "POST", path, params: { model: named ? "arg:0#1" : "arg:0" } },
      auth: entry.auth as AuthScheme,
      args: model.modelId ? [model.modelId] : [],
      inlinePath: true,
      basePath: entry.basePath,
    },
    modelExpr: fromPath ? undefined : model.modelId,
  };
}
