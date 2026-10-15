import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

let openai: OpenAI | undefined;

export function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

let claude;

export function getClaude() {
  claude ??= new Anthropic();
  return claude;
}

let genAiClient = null;

export function initGenAi(apiKey: string) {
  genAiClient = new GoogleGenAI({ apiKey });
}

export async function describe(contents: string) {
  const ai = genAiClient;
  return ai.models.generateContent({ model: "gemini-2.5-flash", contents });
}
