import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { AuthScheme, Callee, RawCall } from "../types.js";
import { unwrap } from "../ast/expr.js";
import { declarationsOf, getProp } from "../ast/object.js";
import { describeCallee, exportedChain } from "./callee.js";
import data from "./registry/ai-sdk.json" with { type: "json" };

export interface AiSdkProvider {
  package: string;
  provider: string;
  host: string;
  basePath?: string;
  auth: string;
  paths: Record<string, string>;
}

const FUNCTIONS = new Set(data.functions);
const AGENTS = new Map<string, string[]>(Object.entries(data.agents));
const PROVIDERS = new Map<string, AiSdkProvider>((data.providers as unknown as AiSdkProvider[]).map((p) => [p.package, p]));
const GATEWAY = data.gateway as unknown as AiSdkProvider;
const MAX_DEPTH = 4;

/** Packages whose models the AI SDK detector reads (they count as supported in the coverage report). */
export const AI_SDK_PACKAGES = new Set(PROVIDERS.keys());

interface Model {
  entry: AiSdkProvider;
  member: string;
  modelId?: Expression;
  baseUrl?: Expression;
}

/** `openai("gpt-4o")`, `openai.chat("gpt-4o")`, `myOpenAI("x")` with `myOpenAI = createOpenAI({ baseURL })`, `"openai/gpt-4o"`. */
function resolveModel(expr: Expression, depth = 0): Model | undefined {
  const u = unwrap(expr);
  if (depth > MAX_DEPTH) return undefined;
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u) || Node.isTemplateExpression(u)) return { entry: GATEWAY, member: "", modelId: u };
  if (Node.isIdentifier(u)) {
    const decl = declarationsOf(u)[0];
    const init = decl && (Node.isVariableDeclaration(decl) || Node.isParameterDeclaration(decl)) ? decl.getInitializer() : undefined;
    return init ? resolveModel(init, depth + 1) : undefined;
  }
  if (!Node.isCallExpression(u)) return undefined;
  const c = describeCallee(u);
  if (c.package === "ai" && exportedChain(c).join(".") === "wrapLanguageModel") {
    const inner = getProp(u.getArguments()[0] as Expression | undefined, "model");
    return inner ? resolveModel(inner, depth + 1) : undefined;
  }
  const entry = c.package ? PROVIDERS.get(c.package) : undefined;
  if (!entry) return undefined;
  const member = c.instance ? c.chain.join(".") : exportedChain(c).slice(1).join(".");
  const baseUrl = c.instance ? getProp(c.instance.args[0], "baseURL") : undefined;
  return { entry, member, modelId: u.getArguments()[0] as Expression | undefined, baseUrl };
}

/** `generateText({ model })` from `ai`, or `new Agent({ model })` from an agent library built on it. */
function aiSdkSite(node: CallExpression | NewExpression, callee: Callee): { fn: string; agent: boolean } | undefined {
  const fn = exportedChain(callee).join(".");
  if (Node.isCallExpression(node) && callee.package === "ai" && FUNCTIONS.has(fn)) return { fn, agent: false };
  if (Node.isNewExpression(node) && callee.package && AGENTS.get(callee.package)?.includes(fn)) return { fn, agent: true };
  return undefined;
}

/** `generateText({ model, prompt })` and friends from `ai`: one request to the model's provider. */
export function detectAiSdk(node: CallExpression | NewExpression, callee: Callee): RawCall | null {
  const site = aiSdkSite(node, callee);
  if (!site) return null;
  const { fn } = site;
  const modelExpr = getProp(node.getArguments()[0] as Expression | undefined, "model");
  const model = modelExpr ? resolveModel(modelExpr) : undefined;
  // an agent's string model (`"openai/gpt-4o"`) goes through the agent library's router, which picks the provider by name
  const routeByModel = site.agent && model?.entry === GATEWAY;
  const unknown: AiSdkProvider = { ...GATEWAY, provider: "unknown", host: "{provider}", paths: { "": "/" } };
  // a model the scan cannot trace: still one LLM request, to a provider it cannot name
  const entry = routeByModel ? { ...unknown, provider: "llm-router" } : (model?.entry ?? unknown);
  const path = entry.paths[model?.member ?? ""] ?? entry.paths[""]!;
  return {
    node,
    client: "sdk",
    sdk: {
      package: entry.package,
      provider: entry.provider,
      host: entry.host,
      chain: fn,
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
