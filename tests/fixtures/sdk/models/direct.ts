import OpenAI from "openai";
import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import ollama from "ollama";
import { CHAT_MODEL, EMBED_MODEL, draftModel } from "./config";

const client = new OpenAI();
const groq = new Groq();
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

export const chat = (content: string) => client.chat.completions.create({ model: CHAT_MODEL, messages: [{ role: "user", content }] });
export const embedAll = (input: string[]) => client.embeddings.create({ model: EMBED_MODEL, input });
export const draft = (input: string) => client.responses.create({ model: draftModel(), input });
export const pick = (fast: boolean) => client.chat.completions.create({ model: fast ? "gpt-4o-mini" : "o3", messages: [] });
export const fastChat = (content: string) => groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content }] });
export const french = (content: string) => mistral.chat.complete({ model: "mistral-small-latest", messages: [{ role: "user", content }] });
export const local = (prompt: string) => ollama.generate({ model: "llama3.2", prompt });
