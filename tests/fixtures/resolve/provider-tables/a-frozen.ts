interface Endpoint {
  baseUrl: string;
  keyEnv: string;
}

export const ENDPOINTS: Record<string, Endpoint> = Object.freeze({
  mistral: { baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_KEY" },
});

export async function listModels(id: string) {
  const endpoint = ENDPOINTS[id];
  return fetch(endpoint.baseUrl + "/models");
}
