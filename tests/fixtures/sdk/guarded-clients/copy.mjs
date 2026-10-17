import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// clients handed in an object and destructured: what the callers put there
async function moveUser({ source, target, userId }) {
  const { data } = await source.auth.admin.getUserById(userId);
  await target.auth.admin.createUser({ email: data.user.email });
}

async function caption({ llm, text } = {}) {
  return llm.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: text }] });
}

export async function migrate(cfg, ids) {
  const source = createClient(cfg.oldUrl, cfg.oldKey);
  const target = createClient(cfg.newUrl, cfg.newKey);
  for (const userId of ids) await moveUser({ source, target, userId });
  return caption({ llm: new OpenAI(), text: "done" });
}
