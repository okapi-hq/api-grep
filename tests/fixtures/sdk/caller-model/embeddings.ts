interface EmbeddingConfig {
  provider: string;
  apiKey: string;
  dimensions?: number;
  model?: string;
}

class BaseEmbedder {
  constructor(protected readonly config: EmbeddingConfig) {}
}

export class VectorEmbedder extends BaseEmbedder {
  private readonly model: string;
  constructor(config: EmbeddingConfig) {
    super(config);
    this.model = config.model ?? "text-embedding-3-small";
  }

  embed(text: string) {
    return fetch("https://api.openai.com/v1/embeddings", { method: "POST", body: JSON.stringify({ model: this.model, input: text }) });
  }
}

export class PresetEmbedder {
  constructor(private readonly config: EmbeddingConfig, private readonly model: string = config.model ?? "text-embedding-3-large") {}

  embed(text: string) {
    return fetch("https://api.openai.com/v1/embeddings", { method: "POST", body: JSON.stringify({ model: this.model, input: text }) });
  }
}

// one caller hands its config through, another leaves the model out: the defaults run
export function createEmbedder(config: EmbeddingConfig) {
  switch (config.provider) {
    case "openai":
      return new VectorEmbedder(config);
    default:
      return new PresetEmbedder(config);
  }
}

export function fromOptions(options: { apiKey: string; dimensions?: number }) {
  return new VectorEmbedder({ provider: "openai", apiKey: options.apiKey, dimensions: options.dimensions });
}
