import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function summarize(text: string) {
  const msg = await anthropic.messages.create({ model: "claude-sonnet-4-5", max_tokens: 512, messages: [{ role: "user", content: text }] });
  return msg.content;
}

export const streamReply = (prompt: string) => anthropic.messages.stream({ model: "claude-sonnet-4-5", max_tokens: 1024, messages: [{ role: "user", content: prompt }] });

export const count = (prompt: string) => anthropic.beta.messages.countTokens({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: prompt }] });

export const models = () => anthropic.models.list();
