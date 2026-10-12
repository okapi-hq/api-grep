import OpenAI from "openai";

const client = new OpenAI();

export async function withUntyped(c: any, prompt: string) {
  return c.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] });
}

withUntyped(client, "hi");
