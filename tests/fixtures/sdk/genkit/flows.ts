import { googleAI } from "@genkit-ai/google-genai";
import { z } from "genkit";
import { ai } from "./assistant";

const DRAFT_MODEL = googleAI.model("gemini-2.5-flash-lite");

export const draftFlow = ai.defineFlow({ name: "draftFlow", inputSchema: z.string() }, async (topic, { sendChunk }) => {
  const { stream, response } = ai.generateStream({ model: DRAFT_MODEL, prompt: `Draft about ${topic}` });
  for await (const chunk of stream) sendChunk(chunk.text);
  return (await response).text;
});

export const pick = (fast: boolean, text: string) => ai.generate({ model: fast ? googleAI.model("gemini-2.5-flash-lite") : "googleai/gemini-2.5-pro", prompt: text });
