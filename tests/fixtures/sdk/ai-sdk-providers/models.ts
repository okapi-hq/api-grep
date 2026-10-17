import { customProvider, experimental_wrapLanguageModel as wrapLanguageModel, extractReasoningMiddleware } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import { gateway } from "@ai-sdk/gateway";
import { inTests } from "./flags";

const mistral = createMistral({ apiKey: process.env.ORCHARD_MISTRAL_KEY });

// the test branch maps names to local doubles: it sends nothing
export const orchard = inTests
  ? (() => {
      const { stubModel } = require("./stubs");
      return customProvider({ languageModels: { "chat-model": stubModel, "title-model": stubModel } });
    })()
  : customProvider({
      languageModels: {
        "chat-model": gateway.languageModel("anthropic/claude-sonnet-4-5"),
        "title-model": wrapLanguageModel({ model: gateway.languageModel("mistral/mistral-small"), middleware: extractReasoningMiddleware({ tagName: "think" }) }),
      },
    });

export const tagger = wrapLanguageModel({ model: anthropic("claude-haiku-4-5"), middleware: extractReasoningMiddleware({ tagName: "x" }) });

export function pickModel(tier: string) {
  if (tier === "pro") return anthropic("claude-opus-4-1");
  return mistral("mistral-large-latest");
}

export function harvestOptions(fast: boolean) {
  if (fast) return { model: mistral("mistral-small-latest"), temperature: 0 };
  return { model: mistral("mistral-large-latest") };
}
