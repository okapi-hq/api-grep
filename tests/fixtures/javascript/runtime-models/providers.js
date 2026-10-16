const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const defaults = require("./defaults.json");

class ClaudeProvider {
  constructor(modelPreference = null) {
    this.client = new Anthropic();
    this.model = modelPreference || process.env.CLAUDE_MODEL_PREF || "claude-sonnet-4-5";
  }

  complete(messages) {
    return this.client.messages.create({ model: this.model, max_tokens: 1024, messages });
  }
}

class LocalProvider {
  constructor(modelPreference = null) {
    this.client = new OpenAI({ baseURL: "http://localhost:11434/v1" });
    this.model = modelPreference || process.env.LOCAL_MODEL_PREF;
  }

  complete(messages) {
    return this.client.chat.completions.create({ model: this.model, messages });
  }
}

function embed(input) {
  return new OpenAI().embeddings.create({ model: defaults.embeddings.model, input });
}

module.exports = { ClaudeProvider, LocalProvider, embed };
