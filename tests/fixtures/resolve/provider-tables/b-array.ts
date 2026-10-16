import OpenAI from "openai";

const CATALOG = [
  { key: "groq", url: "https://api.groq.com/openai/v1" },
  { key: "fireworks", url: "https://api.fireworks.ai/inference/v1" },
  { key: "perplexity", url: "https://api.perplexity.ai" },
];

export function chat(id: string, text: string) {
  const entry = CATALOG.find((p) => p.key === id);
  if (!entry) throw new Error("unknown provider");
  const client = new OpenAI({ baseURL: entry.url });
  return client.chat.completions.create({ model: "chat-model", messages: [{ role: "user", content: text }] });
}
