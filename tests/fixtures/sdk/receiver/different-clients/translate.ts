import OpenAI from "openai";

async function translate(client: any, text: string) {
  return client.chat.completions.create({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: text }] });
}

export const hosted = (text: string) => translate(new OpenAI(), text);

export function fast(text: string) {
  const groq = new OpenAI({ baseURL: "https://api.groq.com/openai/v1" });
  return translate(groq, text);
}
