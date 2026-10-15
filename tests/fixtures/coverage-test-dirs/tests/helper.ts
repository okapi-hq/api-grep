import OpenAI from "openai";

export const fakeClient = new OpenAI({ apiKey: "test", baseURL: "http://localhost:4010" });
