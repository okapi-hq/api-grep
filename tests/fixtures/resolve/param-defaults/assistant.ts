import OpenAI from "openai";

const client = new OpenAI();

export async function summarize(text: string, model = "gpt-4o-mini", maxTokens = 1024) {
  return client.chat.completions.create({ model, max_tokens: maxTokens, messages: [{ role: "user", content: text }] });
}

export async function translate(text: string, model = "gpt-4o-mini", maxTokens = 1024) {
  return client.chat.completions.create({ model, max_tokens: maxTokens, messages: [{ role: "user", content: text }] });
}

export async function classify(text: string, model = "gpt-4o-mini", maxTokens = 1024) {
  return client.chat.completions.create({ model, max_tokens: maxTokens, messages: [{ role: "user", content: text }] });
}

export async function translateBoth(text: string) {
  await translate(text);
  return translate(text, "o3", 4096);
}

export async function classifyWith(text: string, settings: { pickModel(): string; limit: number }) {
  await classify(text);
  return classify(text, settings.pickModel(), settings.limit);
}

export class Writer {
  defaultModel = "gpt-4.1";

  draft(text: string, model?: string) {
    return client.chat.completions.create({ model: model ?? this.defaultModel, messages: [{ role: "user", content: text }] });
  }

  draftFast(text: string) {
    return this.draft(text, "gpt-4.1-nano");
  }
}
