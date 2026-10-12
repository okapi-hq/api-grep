import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Agent as MastraAgent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Agent } from "@openai/agents";
import { initChatModel } from "langchain/chat_models/universal";

export const writer = new ChatOpenAI({ model: "gpt-4o", temperature: 0, apiKey: process.env.OPENAI_API_KEY });
export const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
export const critic = new ChatAnthropic({ model: "claude-3-5-haiku-20241022", maxTokens: 1024 });
export const gemini = new ChatGoogleGenerativeAI({ model: "gemini-1.5-flash", temperature: 0.2 });
export const proxied = new ChatOpenAI({ model: "qwen3:32b", configuration: { baseURL: "http://localhost:11434/v1" } });
export const routed = await initChatModel("anthropic:claude-sonnet-4-20250514", { temperature: 0 });
export const triage = new Agent({ name: "Triage", instructions: "Route the request.", model: "gpt-4.1" });
export const support = new MastraAgent({ name: "support", instructions: "Help.", model: openai("gpt-4o-mini") });
export const researcher = new MastraAgent({ name: "research", instructions: "Search.", model: "google/gemini-2.5-pro" });
