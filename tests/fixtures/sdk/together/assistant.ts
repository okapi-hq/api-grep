import Together from "together-ai";

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

export const answer = (question: string) => together.chat.completions.create({ model: "acme/chat-large", messages: [{ role: "user", content: question }], max_tokens: 256 });

export const streamed = (question: string) => together.chat.completions.create({ model: "acme/chat-large", messages: [{ role: "user", content: question }], stream: true });

export const embed = (text: string) => together.embeddings.create({ model: "acme/embed-small", input: text });

export const picture = (prompt: string) => together.images.generate({ model: "acme/paint-fast", prompt, steps: 4 });

export const ranked = (query: string, documents: string[]) => together.rerank.create({ model: "acme/rerank-base", query, documents, top_n: 3 });

export const speak = (text: string) => together.audio.speech.create({ model: "acme/voice-one", input: text, voice: "calm" });

export const catalog = () => together.models.list();

export const job = (id: string) => together.fineTuning.retrieve(id);

const proxied = new Together({ apiKey: process.env.TOGETHER_API_KEY, baseURL: "https://llm-proxy.example.com/v1" });

export const viaProxy = (question: string) => proxied.chat.completions.create({ model: "acme/chat-small", messages: [{ role: "user", content: question }] });
