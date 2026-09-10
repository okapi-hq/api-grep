import OpenAI from "openai";

const openai = new OpenAI();

export async function ask(prompt: string) {
  const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], temperature: 0.2 });
  return res.choices[0]?.message.content;
}

export const embed = (input: string[]) => openai.embeddings.create({ model: "text-embedding-3-small", input });
