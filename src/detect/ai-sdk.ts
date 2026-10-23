import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { AuthScheme, Callee, RawCall } from "../types.js";
import { GATEWAY, optionsModels, PROVIDERS, type AiSdkProvider, type Model } from "./ai-sdk-model.js";
import { exportedChain } from "./callee.js";
import { GENKIT_PACKAGES } from "./genkit.js";
import data from "./registry/ai-sdk.json" with { type: "json" };

const FUNCTIONS = new Set(data.functions);
const AGENTS = new Map<string, string[]>(Object.entries(data.agents));
/** Packages whose models or agents the AI SDK and Genkit detectors read (they count as supported in the coverage report). */
export const AI_SDK_PACKAGES = new Set([...PROVIDERS.keys(), ...AGENTS.keys(), ...GENKIT_PACKAGES]);

/** Agent libraries (`@mastra/core`) -> their agent constructors: a call with that `sdk.chain` in a file importing it is theirs too. */
export const AI_SDK_AGENTS: ReadonlyMap<string, string[]> = AGENTS;

const UNKNOWN: AiSdkProvider = { ...GATEWAY, provider: "unknown", host: "{provider}", paths: { "": "/" } };

interface Site {
  fn: string;
  agent: boolean;
}

/** `generateText({ model })` from `ai`, or `new Agent({ model })` from an agent library built on it. */
function aiSdkSite(node: CallExpression | NewExpression, callee: Callee): Site | undefined {
  const fn = exportedChain(callee).join(".");
  if (Node.isCallExpression(node) && callee.package === "ai" && FUNCTIONS.has(fn)) return { fn, agent: false };
  if (Node.isNewExpression(node) && callee.package && AGENTS.get(callee.package)?.includes(fn)) return { fn, agent: true };
  return undefined;
}

/**
 * `generateText({ model, prompt })` and friends from `ai`: one request to the model's provider. A model picked at run
 * time among several (`isPro ? anthropic(a) : openai(b)`, a helper's returns) is one request per candidate, the others
 * in `alternatives` (`build-call.ts` reports them as it reports a host table's candidates).
 */
export function detectAiSdk(node: CallExpression | NewExpression, callee: Callee): RawCall | null {
  const site = aiSdkSite(node, callee);
  if (!site) return null;
  const models = optionsModels(node.getArguments()[0] as Expression | undefined);
  const [first, ...rest] = models && models.length > 0 ? models : [undefined];
  const raw = modelCall(node, site, first);
  return rest.length > 0 ? { ...raw, alternatives: rest.map((m) => modelCall(node, site, m)) } : raw;
}

function modelCall(node: CallExpression | NewExpression, site: Site, model: Model | undefined): RawCall {
  // an agent's string model (`"openai/gpt-4o"`) goes through the agent library's router, which picks the provider by name
  const routeByModel = site.agent && model?.entry === GATEWAY;
  // a model the scan cannot trace: still one LLM request, to a provider it cannot name
  const entry = routeByModel ? { ...UNKNOWN, provider: "llm-router" } : (model?.entry ?? UNKNOWN);
  const path = entry.paths[model?.member ?? ""] ?? entry.paths[""]!;
  return {
    node,
    client: "sdk",
    sdk: {
      package: entry.package,
      provider: entry.provider,
      host: entry.host,
      chain: site.fn,
      spec: { method: "POST", path, params: { model: "arg:0" } },
      auth: entry.auth as AuthScheme,
      args: model?.modelId ? [model.modelId] : [],
      inlinePath: true,
      basePath: entry.basePath,
      routeByModel,
    },
    baseUrlExpr: model?.baseUrl,
    modelExpr: model?.modelId,
  };
}
