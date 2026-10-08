const PRESETS = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  groq: { baseUrl: "https://api.groq.com/openai/v1" },
  mistral: { baseUrl: "https://api.mistral.ai/v1" },
  together: { baseUrl: "https://api.together.xyz/v1" },
  deepseek: { baseUrl: "https://api.deepseek.com" },
} as const;

export async function listModels(name: keyof typeof PRESETS) {
  const preset = PRESETS[name];
  const res = await fetch(`${preset.baseUrl}/models`);
  return res.json();
}
