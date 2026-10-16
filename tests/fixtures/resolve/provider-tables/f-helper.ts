const GEMINI_DEFAULT = "https://generativelanguage.googleapis.com/v1beta/openai";

function currentBaseUrl(useGemini: boolean): string {
  if (useGemini) return process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT;
  return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
}

export async function models(useGemini: boolean) {
  const res = await fetch(`${currentBaseUrl(useGemini)}/models`);
  return res.json();
}
