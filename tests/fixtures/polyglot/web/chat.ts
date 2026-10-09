import OpenAI from "openai";

const openai = new OpenAI();

export const ask = (q: string) => openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: q }] });
