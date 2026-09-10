import { postJsonToApi, getFromApi } from "@ai-sdk/provider-utils";

export async function complete(apiKey: string, prompt: string, model: "gpt-4o" | "gpt-4o-mini") {
  return postJsonToApi({
    url: "https://api.openai.com/v1/chat/completions",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { model, messages: [{ role: "user", content: prompt }], temperature: 0.2 },
  });
}

export async function models(apiKey: string) {
  return getFromApi({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${apiKey}` } });
}
