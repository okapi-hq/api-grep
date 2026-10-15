import { InferenceClient } from "@huggingface/inference";

const hf = new InferenceClient(process.env.HF_TOKEN);

export async function chat(q: string) {
  return hf.chatCompletion({ model: "meta-llama/Llama-3.1-8B-Instruct", messages: [{ role: "user", content: q }], max_tokens: 100 });
}

export const gen = (inputs: string) => hf.textGeneration({ model: "gpt2", inputs });
export const img = (inputs: string) => hf.textToImage({ model: "stabilityai/stable-diffusion-2", inputs });
