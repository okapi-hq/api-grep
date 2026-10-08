import OpenAI from "openai";

const openai = new OpenAI();

export async function summarize(text) {
  return openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: text }] });
}

export const weather = (lat, lon) => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`);
