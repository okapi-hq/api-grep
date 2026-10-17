import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { orchard } from "./models";

// one of the helper's returns is a model the scan cannot trace: no provider is named
function modelFor(tier: string, custom: never) {
  if (tier === "pro") return anthropic("claude-opus-4-1");
  return custom;
}

export async function untraced(prompt: string, custom: never) {
  await generateText({ model: modelFor("pro", custom), prompt });
  // a name the provider does not map
  return generateText({ model: orchard.languageModel("missing-model"), prompt });
}
