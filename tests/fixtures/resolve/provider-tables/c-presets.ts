const PRESETS = {
  DeepSeek: { chat: "https://api.deepseek.com/v1", chatModel: "deepseek-chat" },
  SiliconFlow: { chat: "https://api.siliconflow.cn/v1", chatModel: "Qwen/Qwen2.5-7B-Instruct" },
  Moonshot: { chat: "https://api.moonshot.cn/v1", chatModel: "moonshot-v1-8k" },
};

export async function summarize(kind: keyof typeof PRESETS, text: string) {
  const preset = PRESETS[kind];
  const res = await fetch(`${preset.chat}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: preset.chatModel, messages: [{ role: "user", content: text }] }),
  });
  return res.json();
}
