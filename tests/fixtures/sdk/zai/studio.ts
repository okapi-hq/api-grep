import ZAI from "z-ai-web-dev-sdk";

const zai = await ZAI.create();

export const reply = (question: string) => zai.chat.completions.create({ model: "glm-4.6", messages: [{ role: "user", content: question }], stream: false });

export const describe = (url: string) => zai.chat.completions.createVision({ model: "glm-4.5v", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] });

export const poster = (prompt: string) => zai.images.generations.create({ prompt, size: "1024x1024" });

export const speak = (text: string) => zai.audio.tts.create({ input: text, voice: "tongtong", response_format: "wav" });

export const film = (prompt: string) => zai.video.generations.create({ model: "cogvideox-3", prompt, with_audio: true });

export const status = (taskId: string) => zai.async.result.query(taskId);

export const lookup = (query: string) => zai.functions.invoke("web_search", { query, num: 5 });
