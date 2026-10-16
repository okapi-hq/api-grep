interface Logger {
  log(message: string): void;
}

export class ClaudeTextClient {
  constructor(private apiKey: string, private model = "claude-sonnet-4-6", private logger?: Logger) {}

  complete(prompt: string) {
    return fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": this.apiKey }, body: JSON.stringify({ model: this.model, max_tokens: 1, messages: [{ role: "user", content: prompt }] }) });
  }
}

export class GptTextClient {
  constructor(private apiKey: string, private model = "gpt-4o") {}

  complete(prompt: string) {
    return fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }] }) });
  }
}

// each caller gives a model of its own, with a literal fallback: that fallback is a value the request sends
export function makeClaude(env: Record<string, string | undefined>) {
  return new ClaudeTextClient(env.ANTHROPIC_API_KEY!, env.NOTES_MODEL ?? "claude-sonnet-4-6");
}

export function makeGpt(env: Record<string, string | undefined>) {
  return new GptTextClient(env.OPENAI_API_KEY!, env.NOTES_MODEL ?? "gpt-4o-mini");
}
