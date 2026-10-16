// SDKs loaded when first needed
export async function describePlot(photo: string) {
  const { OpenAI } = await import("openai");
  const vision = new OpenAI({ apiKey: process.env.GARDEN_OPENAI_KEY });
  return vision.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: photo }] });
}

// one path builds a client of a package no provider is known for: the known SDK's client is the one followed
async function plotClient() {
  if (process.env.GARDEN_GATEWAY) {
    const { GatewayClient } = await import("@greenhouse/llm-gateway");
    return new GatewayClient({ region: "eu" });
  }
  const { OpenAI } = await import("openai");
  return new OpenAI();
}

export async function namePlot(photo: string) {
  const client = await plotClient();
  return client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: photo }] });
}

export async function mailPlot(to: string) {
  const mod = await import("resend");
  const resend = new mod.Resend(process.env.GARDEN_MAIL_KEY);
  return resend.emails.send({ from: "garden@example.com", to, subject: "Your plot", html: "<p>Ready</p>" });
}
