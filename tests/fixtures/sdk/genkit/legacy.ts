import { gemini15Flash, googleAI, textEmbedding004 } from "@genkit-ai/googleai";
import { gemini20Flash001, vertexAI } from "@genkit-ai/vertexai";
import { genkit } from "genkit";

const ai = genkit({ plugins: [googleAI(), vertexAI({ location: "us-central1" })], model: gemini15Flash });
export const reply = (text: string) => ai.generate(text);
export const embedText = (content: string) => ai.embed({ embedder: textEmbedding004, content });
export const onVertex = (text: string) => ai.generate({ model: gemini20Flash001, prompt: text });
export const named = (text: string) => ai.generate({ model: "vertexai/gemini-2.5-flash", prompt: text });
