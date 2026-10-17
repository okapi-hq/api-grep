import { generateText, streamText } from "ai";
import { harvestOptions, orchard, pickModel, tagger } from "./models";

export async function chat(prompt: string, picked: string, tier: string) {
  await streamText({ model: orchard.languageModel("chat-model"), prompt });
  await streamText({ model: orchard.languageModel(picked), prompt });
  await generateText({ model: tagger, prompt });
  await generateText({ model: pickModel(tier), prompt });
  let model;
  try {
    model = pickModel(tier);
  } catch {
    return null;
  }
  await generateText({ model, prompt });
  return generateText({ ...harvestOptions(tier === "fast"), prompt });
}
