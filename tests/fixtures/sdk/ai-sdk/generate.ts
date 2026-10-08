import { anthropic } from "@ai-sdk/anthropic";
import { createVertex } from "@ai-sdk/google-vertex";
import { google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { embed, generateObject, generateText, streamText } from "ai";

const together = createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey: process.env.TOGETHER_API_KEY });
const routed = openrouter("meta-llama/llama-3.3-70b-instruct");

export const answer = (prompt: string) => generateText({ model: openai("gpt-4o"), prompt });
export const stream = (prompt: string) => streamText({ model: anthropic("claude-sonnet-4-5"), prompt });
export const extract = (prompt: string, schema: never) => generateObject({ model: google("gemini-2.5-flash"), schema, prompt });
export const vector = (value: string) => embed({ model: openai.embedding("text-embedding-3-small"), value });
export const cheap = (prompt: string) => generateText({ model: together("meta-llama/Llama-3-8b-chat-hf"), prompt });
export const gateway = (prompt: string) => generateText({ model: "openai/gpt-4o-mini", prompt });
export const router = (prompt: string) => generateText({ model: routed, prompt });

const vertex = createVertex({ project: "demo-project", location: "europe-west4" });
export const onVertex = (prompt: string) => generateText({ model: vertex("gemini-2.5-flash"), prompt });
export const untraced = (model: never, prompt: string) => generateText({ model, prompt });
