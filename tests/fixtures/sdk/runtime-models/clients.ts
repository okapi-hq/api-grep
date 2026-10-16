import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import config from "./config.json";
import { env, t3 } from "./env";

const openai = new OpenAI();
const fileSettings = JSON.parse(readFileSync(path.join(__dirname, "settings.json"), "utf8"));
const yamlConfig = YAML.parse(readFileSync("llm.yaml", "utf8"));

export class Writer {
  private model: string;
  private claude = new Anthropic();
  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? process.env.WRITER_MODEL ?? "claude-sonnet-4-5";
  }
  write(prompt: string) {
    return this.claude.messages.create({ model: this.model, max_tokens: 512, messages: [{ role: "user", content: prompt }] });
  }
}

export class FastChat {
  static fallback = "llama-3.3-70b-versatile";
  private groq = new Groq();
  constructor(private model: string = "llama-3.1-8b-instant") {}
  ask(q: string) {
    return this.groq.chat.completions.create({ model: this.model, messages: [{ role: "user", content: q }] });
  }
  retry(q: string) {
    return this.groq.chat.completions.create({ model: FastChat.fallback, messages: [{ role: "user", content: q }] });
  }
}

export const chat = (q: string) => openai.chat.completions.create({ model: env.CHAT_MODEL, messages: [{ role: "user", content: q }] });
export const embed = (input: string) => openai.embeddings.create({ model: env.EMBED_MODEL, input });
export const summarize = (input: string) => openai.responses.create({ model: t3.SUMMARY_MODEL, input });
export const describe = (input: string) => openai.responses.create({ model: t3.VISION_MODEL, input });
export const judge = (q: string) => openai.chat.completions.create({ model: config.llm.judge, messages: [{ role: "user", content: q }] });
export const grade = (q: string) => openai.chat.completions.create({ model: fileSettings.grader ?? "o4-mini", messages: [{ role: "user", content: q }] });
export const route = (q: string) => openai.chat.completions.create({ model: yamlConfig.router.model, messages: [{ role: "user", content: q }] });
export const plain = (q: string) => openai.chat.completions.create({ model: process.env.PLAIN_MODEL!, messages: [{ role: "user", content: q }] });
