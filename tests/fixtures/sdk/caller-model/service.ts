import OpenAI from "openai";

export class OpenAIService {
  private client = new OpenAI();
  constructor(private model: string = "gpt-5-nano") {}

  generateText(prompt: string) {
    return this.client.chat.completions.create({ model: this.model, messages: [{ role: "user", content: prompt }] });
  }
}

export class OtherService {
  private client = new OpenAI();
  private model: string;
  constructor(model?: string) {
    this.model = model ?? "gpt-5-nano";
  }

  generateText(prompt: string) {
    return this.client.chat.completions.create({ model: this.model, messages: [{ role: "user", content: prompt }] });
  }
}

export class Summarizer {
  private client = new OpenAI();
  constructor(private model: string = "gpt-4.1-mini") {}

  summarize(text: string) {
    return this.client.responses.create({ model: this.model, input: text });
  }
}
