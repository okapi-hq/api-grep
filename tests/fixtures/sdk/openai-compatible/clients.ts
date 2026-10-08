import OpenAI from "openai";

const openrouter = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
const groq = new OpenAI({ baseURL: process.env.GROQ_BASE_URL, apiKey: process.env.GROQ_API_KEY });
const local = new OpenAI({ baseURL: "http://localhost:11434/v1", apiKey: "ollama" });
const plain = new OpenAI();

export const viaRouter = (content: string) => openrouter.chat.completions.create({ model: "anthropic/claude-sonnet-4.5", messages: [{ role: "user", content }] });
export const viaGroq = (content: string) => groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content }] });
export const viaOllama = (content: string) => local.chat.completions.create({ model: "llama3.2", messages: [{ role: "user", content }] });
export const direct = (input: string) => plain.embeddings.create({ model: "text-embedding-3-small", input });
