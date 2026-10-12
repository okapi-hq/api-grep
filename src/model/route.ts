/**
 * Libraries that pick the provider from the model name (LiteLLM's `anthropic/claude-sonnet-4`, PydanticAI's
 * `openai:gpt-4o`, DSPy's `openai/gpt-4o-mini`, LangChain's `init_chat_model("groq:llama-3.3-70b")`): the provider,
 * host and chat path the name routes to. A name without a prefix routes by its family (`gpt-` to OpenAI, `claude-` to
 * Anthropic), as those libraries do. Unknown names route nowhere.
 */

export interface ModelRoute {
  provider: string;
  host: string;
  /** The chat path. */
  path: string;
  /** Other operations' paths, by OpenAI operation id (`createEmbedding`). */
  paths?: Record<string, string>;
}

const OPENAI: ModelRoute = {
  provider: "openai",
  host: "api.openai.com",
  path: "/v1/chat/completions",
  paths: { createEmbedding: "/v1/embeddings", createResponse: "/v1/responses", createImage: "/v1/images/generations", createTranscription: "/v1/audio/transcriptions", createSpeech: "/v1/audio/speech" },
};
const ANTHROPIC: ModelRoute = { provider: "anthropic", host: "api.anthropic.com", path: "/v1/messages" };
const GEMINI: ModelRoute = {
  provider: "google-ai",
  host: "generativelanguage.googleapis.com",
  path: "/v1beta/models/{model}:generateContent",
  paths: { createEmbedding: "/v1beta/models/{model}:embedContent" },
};
const embeddings = (route: ModelRoute, path: string): ModelRoute => ({ ...route, paths: { createEmbedding: path } });

/** Prefixes (before `/` or `:`) as the routing libraries spell them. */
const PREFIXES: Record<string, ModelRoute> = {
  openai: OPENAI,
  "openai-chat": OPENAI,
  "openai-responses": { ...OPENAI, path: "/v1/responses" },
  anthropic: ANTHROPIC,
  claude: ANTHROPIC,
  gemini: GEMINI,
  google: GEMINI,
  "google-gla": GEMINI,
  google_genai: GEMINI,
  "google-genai": GEMINI,
  vertex_ai: { provider: "google-vertex", host: "{location}-aiplatform.googleapis.com", path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent" },
  "google-vertex": { provider: "google-vertex", host: "{location}-aiplatform.googleapis.com", path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent" },
  google_vertexai: { provider: "google-vertex", host: "{location}-aiplatform.googleapis.com", path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent" },
  groq: { provider: "groq", host: "api.groq.com", path: "/openai/v1/chat/completions" },
  mistral: embeddings({ provider: "mistral", host: "api.mistral.ai", path: "/v1/chat/completions" }, "/v1/embeddings"),
  mistralai: embeddings({ provider: "mistral", host: "api.mistral.ai", path: "/v1/chat/completions" }, "/v1/embeddings"),
  cohere: embeddings({ provider: "cohere", host: "api.cohere.com", path: "/v2/chat" }, "/v2/embed"),
  deepseek: { provider: "deepseek", host: "api.deepseek.com", path: "/chat/completions" },
  xai: { provider: "xai", host: "api.x.ai", path: "/v1/chat/completions" },
  openrouter: { provider: "openrouter", host: "openrouter.ai", path: "/api/v1/chat/completions" },
  together_ai: { provider: "together", host: "api.together.xyz", path: "/v1/chat/completions" },
  together: { provider: "together", host: "api.together.xyz", path: "/v1/chat/completions" },
  fireworks_ai: { provider: "fireworks", host: "api.fireworks.ai", path: "/inference/v1/chat/completions" },
  fireworks: { provider: "fireworks", host: "api.fireworks.ai", path: "/inference/v1/chat/completions" },
  perplexity: { provider: "perplexity", host: "api.perplexity.ai", path: "/chat/completions" },
  cerebras: { provider: "cerebras", host: "api.cerebras.ai", path: "/v1/chat/completions" },
  huggingface: { provider: "huggingface", host: "router.huggingface.co", path: "/v1/chat/completions" },
  bedrock: { provider: "aws-bedrock", host: "bedrock-runtime.{region}.amazonaws.com", path: "/model/{model}/converse" },
  bedrock_converse: { provider: "aws-bedrock", host: "bedrock-runtime.{region}.amazonaws.com", path: "/model/{model}/converse" },
  azure: embeddings({ provider: "azure-openai", host: "{resource}.openai.azure.com", path: "/openai/deployments/{model}/chat/completions" }, "/openai/deployments/{model}/embeddings"),
  azure_openai: embeddings({ provider: "azure-openai", host: "{resource}.openai.azure.com", path: "/openai/deployments/{model}/chat/completions" }, "/openai/deployments/{model}/embeddings"),
  ollama: embeddings({ provider: "ollama", host: "localhost:11434", path: "/api/chat" }, "/api/embed"),
  ollama_chat: embeddings({ provider: "ollama", host: "localhost:11434", path: "/api/chat" }, "/api/embed"),
};

/** Families of unprefixed names, as LiteLLM and CrewAI default them. */
const FAMILIES: Array<[RegExp, ModelRoute]> = [
  [/^(gpt-|o\d(-|$)|chatgpt-|text-embedding-|whisper-|dall-e-|tts-|davinci|babbage|codex-)/, OPENAI],
  [/^claude-/, ANTHROPIC],
  [/^gemini-|^gemma-/, GEMINI],
  [/^(command|embed-(english|multilingual))/, PREFIXES.cohere!],
  [/^(mistral-|mixtral-|codestral|open-mistral|pixtral|ministral)/, PREFIXES.mistral!],
  [/^deepseek-/, PREFIXES.deepseek!],
  [/^grok-/, PREFIXES.xai!],
];

/** The prefix of a routed name and the model left once it is dropped (`groq/llama-3` gives `groq`, `llama-3`). */
export function splitModel(name: string): { prefix?: string; model: string } {
  const m = /^([A-Za-z][\w-]*)[/:](.+)$/.exec(name.trim());
  if (m && PREFIXES[m[1]!.toLowerCase()]) return { prefix: m[1]!.toLowerCase(), model: m[2]! };
  return { model: name.trim() };
}

/** The path an operation takes on a route: its own, the chat path for chat, none for an operation the route lacks. */
export function routePath(route: ModelRoute, operationId: string | undefined): string | undefined {
  if (operationId && operationId !== "createChatCompletion") return route.paths?.[operationId];
  return route.path;
}

/** Where a model name routes; undefined for a name no prefix nor family places. */
export function routeOf(name: string): ModelRoute | undefined {
  const { prefix, model } = splitModel(name);
  if (prefix) return PREFIXES[prefix];
  return FAMILIES.find(([re]) => re.test(model.toLowerCase()))?.[1];
}
