interface SharedConfig {
  dimensions?: number;
}

export interface VectorConfig extends SharedConfig {
  provider: "vector";
  apiKey: string;
  /** the names the type allows */
  model?: "text-embedding-3-small" | "text-embedding-3-large";
}

export interface LocalConfig extends SharedConfig {
  provider: "local";
}

export class TypedEmbedder {
  private readonly model: string;
  constructor(config: VectorConfig) {
    this.model = config.model ?? "text-embedding-ada-002";
  }

  embed(text: string) {
    return fetch("https://api.openai.com/v1/embeddings", { method: "POST", body: JSON.stringify({ model: this.model, input: text }) });
  }
}

export function pick(config: VectorConfig | LocalConfig) {
  return config.provider === "vector" ? new TypedEmbedder(config) : undefined;
}

export function fromKey(apiKey: string) {
  return new TypedEmbedder({ provider: "vector", apiKey });
}
