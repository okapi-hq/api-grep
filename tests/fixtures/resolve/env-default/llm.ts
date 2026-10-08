const base = process.env.LANGDOCK_BASE_URL ?? "https://api.langdock.com/openai/eu/v1";

export function complete(prompt: string) {
  return fetch(`${base}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }] }) });
}

export const voices = () => fetch(`${process.env.TTS_URL || "https://api.elevenlabs.io"}/v1/voices`);
