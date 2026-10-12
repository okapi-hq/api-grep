import type { Shape } from "../types.js";

/**
 * Settings of a JavaScript model client (LangChain.js) that configure it rather than its requests: keys, endpoints,
 * transport, callbacks. What is left (model, temperature, maxTokens...) is what each request sends.
 */
const CLIENT_PROPS = new Set([
  "apiKey", "openAIApiKey", "anthropicApiKey", "googleApiKey", "groqApiKey", "mistralApiKey", "azureOpenAIApiKey",
  "azureOpenAIApiInstanceName", "azureOpenAIApiDeploymentName", "azureOpenAIApiVersion", "azureOpenAIEndpoint", "azureOpenAIBasePath",
  "configuration", "clientOptions", "baseURL", "baseUrl", "anthropicApiUrl", "endpoint", "serverURL", "region", "credentials",
  "callbacks", "callbackManager", "verbose", "cache", "tags", "metadata", "maxRetries", "maxConcurrency", "onFailedAttempt",
  "timeout", "streaming", "disableStreaming", "fetch", "fetchFn", "headers",
]);

/** The body a model client's requests send: its settings without the client's own. */
export function withoutClientSettings(shape: Shape | undefined): Shape | undefined {
  if (shape?.type !== "object") return shape;
  const properties = Object.fromEntries(Object.entries(shape.properties).filter(([k]) => !CLIENT_PROPS.has(k)));
  return { ...shape, properties, required: shape.required.filter((k) => k in properties) };
}
