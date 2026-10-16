import OpenAI from "openai";

const PROVIDERS = {
  openai: { baseUrl: "https://api.openai.com/v1", label: "OpenAI" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", label: "DeepSeek" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", label: "Groq" },
} as const;

type ProviderName = keyof typeof PROVIDERS;

export async function complete(name: ProviderName, prompt: string) {
  const p = PROVIDERS[name];
  const res = await fetch(`${p.baseUrl}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "any-model", messages: [{ role: "user", content: prompt }] }) });
  return res.json();
}

export function ask(name: ProviderName, prompt: string) {
  const client = new OpenAI({ baseURL: PROVIDERS[name].baseUrl, apiKey: process.env.LLM_KEY });
  return client.chat.completions.create({ model: "small-model", messages: [{ role: "user", content: prompt }] });
}
