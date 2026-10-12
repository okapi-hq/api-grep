export const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-4.1-mini";
export const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large";

export function draftModel(): string {
  return process.env.DRAFT_MODEL ?? "gpt-4o";
}
