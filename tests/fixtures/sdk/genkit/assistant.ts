import { googleAI, vertexAI } from "@genkit-ai/google-genai";
import { genkit, z } from "genkit";

export const ai = genkit({ plugins: [googleAI()], model: googleAI.model("gemini-2.5-flash") });
export const greet = (name: string) => ai.generate(`Say hello to ${name}`);
export const summarize = (text: string) => ai.generate({ model: googleAI.model("gemini-2.5-pro"), prompt: text });
export const stream = (text: string) => ai.generateStream({ model: "googleai/gemini-2.5-flash-lite", prompt: text });
export const vector = (content: string) => ai.embed({ embedder: googleAI.embedder("gemini-embedding-001"), content });
export const titleFlow = ai.defineFlow({ name: "titleFlow", inputSchema: z.string() }, async (topic) => {
  const { text } = await ai.generate({ prompt: `A title for ${topic}` });
  return text;
});
export const tagger = ai.definePrompt({ name: "tagger", model: googleAI.model("gemini-2.5-flash-lite"), prompt: "Tags for {{text}}" });

const cloud = genkit({ plugins: [vertexAI({ location: "europe-west4" })] });
export const onVertex = (text: string) => cloud.generate({ model: vertexAI.model("gemini-2.5-pro"), prompt: text });
export const vertexVector = (content: string) => cloud.embed({ embedder: vertexAI.embedder("text-embedding-005"), content });
export const vertexNoModel = (text: string) => cloud.generate(text);

const both = genkit({ plugins: [googleAI(), vertexAI()] });
export const unreadModel = (model: string, text: string) => both.generate({ model, prompt: text });
export const vertexMultimodal = (content: string) => cloud.embed({ embedder: vertexAI.embedder("gemini-embedding-2"), content });
export const clip = (prompt: string) => ai.generate({ model: googleAI.model("veo-3.0-generate-001"), prompt });
export const poster = (prompt: string) => cloud.generate({ model: vertexAI.model("imagen-4.0-generate-001"), prompt });
