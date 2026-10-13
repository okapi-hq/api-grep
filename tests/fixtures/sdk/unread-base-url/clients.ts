import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

declare function loadSettings(): { inferenceUrl: string; claudeUrl: string };
const settings = loadSettings();

export const forHost = (baseURL: string) => new OpenAI({ baseURL, apiKey: "local" });
const fromSettings = new OpenAI({ baseURL: settings.inferenceUrl });
const proxied = new OpenAI({ baseURL: "/api/inference", dangerouslyAllowBrowser: true });
const fallback = new OpenAI({ baseURL: undefined });
const claude = new Anthropic({ baseURL: settings.claudeUrl });

export const viaParam = (content: string) => forHost("x").chat.completions.create({ model: "qwen2.5", messages: [{ role: "user", content }] });
export const viaSettings = (content: string) => fromSettings.chat.completions.create({ model: "llama-3.1-8b", messages: [{ role: "user", content }] });
export const viaProxy = (content: string) => proxied.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content }] });
export const viaDefault = (content: string) => fallback.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content }] });
export const viaClaude = (content: string) => claude.messages.create({ model: "claude-sonnet-4-5", max_tokens: 64, messages: [{ role: "user", content }] });
