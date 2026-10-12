import OpenAI from "openai";

const client = new OpenAI();

export async function complete(prompt: string, reasoning: boolean) {
  const params: Record<string, unknown> = { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] };
  if (reasoning) params.max_completion_tokens = 64;
  else params.max_tokens = 64;
  return client.chat.completions.create(params as never);
}

export async function pickModel(prompt: string, fast: boolean) {
  const params: Record<string, unknown> = { messages: [{ role: "user", content: prompt }] };
  if (fast) {
    params["model"] = "gpt-4o-mini";
  } else {
    params["model"] = "o3";
  }
  return client.chat.completions.create(params as never);
}

export async function assigned(prompt: string, user?: string) {
  const params: Record<string, unknown> = { messages: [{ role: "user", content: prompt }], logprobs: true, seed: 1 };
  Object.assign(params, { model: "gpt-4.1", seed: 7 });
  if (user) Object.assign(params, { user });
  delete params.logprobs;
  return client.chat.completions.create(params as never);
}

export async function later(prompt: string) {
  const params: Record<string, unknown> = { model: "gpt-4o", messages: [{ role: "user", content: prompt }] };
  const sent = await client.chat.completions.create(params as never);
  params.temperature = 0;
  const helper = () => {
    params.top_p = 1;
  };
  helper();
  return sent;
}

export async function hostileKey(prompt: string) {
  const params: Record<string, unknown> = { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] };
  params["__proto__"] = { polluted: true };
  params.constructor = 1;
  return client.chat.completions.create(params as never);
}
