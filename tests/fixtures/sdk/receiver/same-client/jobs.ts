import OpenAI from "openai";
import { summarize } from "./helpers";

export function nightlyDigest(notes: string) {
  const llm = new OpenAI();
  return summarize(llm, notes);
}

export function weeklyReport(notes: string) {
  return summarize(new OpenAI({ timeout: 30_000 }), notes);
}
