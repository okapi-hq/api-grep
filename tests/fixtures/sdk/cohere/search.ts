import { CohereClient, CohereClientV2 } from "cohere-ai";

const legacy = new CohereClient({ token: process.env.CO_API_KEY });
const cohere = new CohereClientV2({ token: process.env.CO_API_KEY });

export const reply = (message: string) => legacy.chat({ model: "acme-command", message, chatHistory: [{ role: "USER", message: "hi" }], accepts: "text/event-stream" });

export const vectors = (texts: string[]) => legacy.embed({ model: "acme-embed", texts, inputType: "search_document" });

export const viaV2 = (text: string) => legacy.v2.chat({ model: "acme-command", messages: [{ role: "user", content: text }] });

export const talk = (text: string) => cohere.chat({ model: "acme-command", messages: [{ role: "user", content: text }], maxTokens: 200, responseFormat: { type: "json_object", jsonSchema: { type: "object", properties: { cityName: { type: "string" } } } } });

export const live = (text: string) => cohere.chatStream({ model: "acme-command", messages: [{ role: "user", content: text }] });

export const order = (query: string, documents: string[]) => cohere.rerank({ model: "acme-rerank", query, documents, topN: 3 });

export const embedV2 = (texts: string[]) => cohere.embed({ model: "acme-embed", texts, inputType: "search_query", embeddingTypes: ["float"] });

export const tokens = (text: string) => cohere.tokenize({ text, model: "acme-command" });

export const models = () => cohere.models.list({ pageSize: 10 });
