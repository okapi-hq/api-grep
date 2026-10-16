import { VertexAI } from "@google-cloud/vertexai";

const vertex = new VertexAI({ project: "acme-notes", location: "europe-west4" });

export async function summarize(text: string) {
  const model = vertex.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text }] }] });
  return result.response;
}

const config = { model: "gemini-2.5-pro", generationConfig: { temperature: 0.2 } };

export const draft = (prompt: string) => vertex.getGenerativeModel(config).generateContentStream(prompt);
