import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();
const prop = (c: Call, key: string): unknown => (c.body as { properties?: Record<string, unknown> } | undefined)?.properties?.[key];

describe("together-ai", () => {
  it("the Stainless client: chat, embeddings, images, rerank, speech, models, fine-tuning, a base URL of the code", async () => {
    const r = await scanFixture("sdk/together");
    expect(at(r, "assistant.ts", 5)).toMatchObject({ provider: "together", method: "POST", host: "api.together.ai", pathTemplate: "/v1/chat/completions", authScheme: "bearer", model: { values: ["acme/chat-large"] } });
    expect(keys(at(r, "assistant.ts", 5))).toEqual(["max_tokens", "messages", "model"]);
    expect(keys(at(r, "assistant.ts", 7))).toEqual(["messages", "model", "stream"]);
    expect(at(r, "assistant.ts", 9)).toMatchObject({ pathTemplate: "/v1/embeddings", model: { values: ["acme/embed-small"] } });
    expect(at(r, "assistant.ts", 11)).toMatchObject({ pathTemplate: "/v1/images/generations", model: { values: ["acme/paint-fast"] } });
    expect(at(r, "assistant.ts", 13)).toMatchObject({ pathTemplate: "/v1/rerank", model: { values: ["acme/rerank-base"] } });
    expect(at(r, "assistant.ts", 15)).toMatchObject({ pathTemplate: "/v1/audio/speech", model: { values: ["acme/voice-one"] } });
    expect(at(r, "assistant.ts", 17)).toMatchObject({ method: "GET", pathTemplate: "/v1/models" });
    expect(at(r, "assistant.ts", 19)).toMatchObject({ method: "GET", pathTemplate: "/v1/fine-tunes/{id}" });
    // the base URL the code gives carries its own `/v1`
    expect(at(r, "assistant.ts", 23)).toMatchObject({ host: "llm-proxy.example.com", pathTemplate: "/v1/chat/completions", model: { values: ["acme/chat-small"] } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["together-ai", "ok"]]);
  });
});

describe("cohere-ai", () => {
  it("CohereClient on /v1 (and its v2), CohereClientV2 on /v2, keys sent in snake case", async () => {
    const r = await scanFixture("sdk/cohere");
    expect(at(r, "search.ts", 6)).toMatchObject({ provider: "cohere", method: "POST", host: "api.cohere.com", pathTemplate: "/v1/chat", authScheme: "bearer", model: { values: ["acme-command"] } });
    // `chatHistory` is sent as `chat_history`; `accepts` is a header
    expect(keys(at(r, "search.ts", 6))).toEqual(["chat_history", "message", "model"]);
    expect(keys(at(r, "search.ts", 8))).toEqual(["input_type", "model", "texts"]);
    expect(at(r, "search.ts", 10)).toMatchObject({ pathTemplate: "/v2/chat", sdk: { chain: "v2.chat" } });
    expect(at(r, "search.ts", 12)).toMatchObject({ pathTemplate: "/v2/chat", model: { values: ["acme-command"] } });
    expect(keys(at(r, "search.ts", 12))).toEqual(["max_tokens", "messages", "model", "response_format"]);
    // a JSON schema's own property names are sent as written
    expect(JSON.stringify(prop(at(r, "search.ts", 12), "response_format"))).toContain('"json_schema"');
    expect(JSON.stringify(prop(at(r, "search.ts", 12), "response_format"))).toContain('"cityName"');
    expect(at(r, "search.ts", 14)).toMatchObject({ pathTemplate: "/v2/chat" });
    expect(at(r, "search.ts", 16)).toMatchObject({ pathTemplate: "/v2/rerank", model: { values: ["acme-rerank"] } });
    expect(keys(at(r, "search.ts", 16))).toEqual(["documents", "model", "query", "top_n"]);
    expect(at(r, "search.ts", 18)).toMatchObject({ pathTemplate: "/v2/embed" });
    // the methods CohereClientV2 shares with CohereClient
    expect(at(r, "search.ts", 20)).toMatchObject({ pathTemplate: "/v1/tokenize" });
    expect(at(r, "search.ts", 22)).toMatchObject({ method: "GET", pathTemplate: "/v1/models", query: ["page_size"] });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["cohere-ai", "ok"]]);
  });
});

describe("ElevenLabs", () => {
  it("@elevenlabs/elevenlabs-js: the voice in the path, snake case keys, query keys of the request object", async () => {
    const r = await scanFixture("sdk/elevenlabs");
    const tts = at(r, "narrator.ts", 5);
    expect(tts).toMatchObject({ provider: "elevenlabs", method: "POST", host: "api.elevenlabs.io", pathTemplate: "/v1/text-to-speech/{voice_id}", authScheme: "apikey", model: { values: ["acme_voice_v2"] }, query: ["output_format"] });
    expect(keys(tts)).toEqual(["model_id", "text", "voice_settings"]);
    expect(Object.keys((prop(tts, "voice_settings") as { properties: object }).properties)).toEqual(["stability", "similarity_boost"]);
    expect(at(r, "narrator.ts", 7)).toMatchObject({ pathTemplate: "/v1/text-to-speech/{voice_id}/stream", model: { values: ["acme_voice_fast"] } });
    expect(at(r, "narrator.ts", 9)).toMatchObject({ pathTemplate: "/v1/text-to-speech/{voice_id}/with-timestamps" });
    expect(at(r, "narrator.ts", 11)).toMatchObject({ pathTemplate: "/v1/speech-to-text", bodyEncoding: "multipart", model: { values: ["acme_scribe"] } });
    expect(keys(at(r, "narrator.ts", 11))).toEqual(["file", "model_id", "tag_audio_events"]);
    expect(keys(at(r, "narrator.ts", 13))).toEqual(["duration_seconds", "text"]);
    expect(at(r, "narrator.ts", 15)).toMatchObject({ method: "GET", pathTemplate: "/v2/voices", query: ["page_size"] });
    expect(at(r, "narrator.ts", 17)).toMatchObject({ method: "GET", pathTemplate: "/v1/voices/{voice_id}" });
    expect(at(r, "narrator.ts", 19)).toMatchObject({ method: "GET", pathTemplate: "/v1/models" });
    expect(at(r, "narrator.ts", 21)).toMatchObject({ method: "GET", pathTemplate: "/v1/convai/conversation/get-signed-url", query: ["agent_id"] });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@elevenlabs/elevenlabs-js", "ok"]]);
  });

  it("elevenlabs (npm 1.x): the same client, snake case keys as written, the older method names", async () => {
    const r = await scanFixture("sdk/elevenlabs-legacy");
    expect(at(r, "speak.ts", 5)).toMatchObject({ provider: "elevenlabs", pathTemplate: "/v1/text-to-speech/{voice_id}", authScheme: "apikey", model: { values: ["acme_voice_v2"] }, query: ["output_format"] });
    expect(keys(at(r, "speak.ts", 5))).toEqual(["model_id", "text"]);
    expect(at(r, "speak.ts", 7)).toMatchObject({ pathTemplate: "/v1/text-to-speech/{voice_id}/stream" });
    expect(at(r, "speak.ts", 9)).toMatchObject({ method: "GET", pathTemplate: "/v1/models" });
    expect(at(r, "speak.ts", 11)).toMatchObject({ pathTemplate: "/v1/convai/conversation/get-signed-url", query: ["agent_id"] });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["elevenlabs", "ok"]]);
  });
});

describe("z-ai-web-dev-sdk", () => {
  it("ZAI.create(): a base URL from a config file read at run time, each method's argument as the body", async () => {
    const r = await scanFixture("sdk/zai");
    // `.z-ai-config` gives the base URL at run time; the SDK has no default
    expect(at(r, "studio.ts", 5)).toMatchObject({ provider: "zai", method: "POST", host: "{zaiBaseUrl}", pathTemplate: "/chat/completions", authScheme: "bearer", model: { values: ["glm-4.6"] } });
    expect(keys(at(r, "studio.ts", 5))).toEqual(["messages", "model", "stream"]);
    expect(at(r, "studio.ts", 7)).toMatchObject({ pathTemplate: "/chat/completions/vision", model: { values: ["glm-4.5v"] } });
    expect(at(r, "studio.ts", 9)).toMatchObject({ pathTemplate: "/images/generations" });
    expect(at(r, "studio.ts", 11)).toMatchObject({ pathTemplate: "/audio/tts" });
    expect(at(r, "studio.ts", 13)).toMatchObject({ pathTemplate: "/video/generation", model: { values: ["cogvideox-3"] } });
    expect(at(r, "studio.ts", 15)).toMatchObject({ method: "GET", pathTemplate: "/async-result", query: ["id"] });
    expect(at(r, "studio.ts", 17)).toMatchObject({ pathTemplate: "/functions/invoke" });
    expect(keys(at(r, "studio.ts", 17))).toEqual(["arguments", "function_name"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["z-ai-web-dev-sdk", "ok"]]);
  });
});

describe("Genkit", () => {
  const gemini = (model: string, action = "generateContent"): string => `/v1beta/models/${model}:${action}`;
  const vertex = (model: string, action = "generateContent", version = "v1beta1"): string => `/${version}/projects/{project}/locations/{location}/publishers/google/models/${model}:${action}`;

  it("@genkit-ai/google-genai: the model of the call, else the instance's; streams, embedders, flows, prompts", async () => {
    const r = await scanFixture("sdk/genkit");
    // `genkit({ model })`'s default
    expect(at(r, "assistant.ts", 5)).toMatchObject({ provider: "google-ai", method: "POST", host: "generativelanguage.googleapis.com", pathTemplate: gemini("gemini-2.5-flash"), authScheme: "apikey", model: { values: ["gemini-2.5-flash"] }, sdk: { package: "@genkit-ai/google-genai", chain: "generate" } });
    expect(at(r, "assistant.ts", 6)).toMatchObject({ pathTemplate: gemini("gemini-2.5-pro"), model: { values: ["gemini-2.5-pro"], from: "argument" } });
    // a string naming the plugin: the name after its prefix
    expect(at(r, "assistant.ts", 7)).toMatchObject({ pathTemplate: gemini("gemini-2.5-flash-lite", "streamGenerateContent"), model: { values: ["gemini-2.5-flash-lite"], from: "path" } });
    expect(at(r, "assistant.ts", 8)).toMatchObject({ pathTemplate: gemini("gemini-embedding-001", "embedContent"), model: { values: ["gemini-embedding-001"] }, sdk: { chain: "embed" } });
    // in a flow, the default model; a prompt where it is defined
    expect(at(r, "assistant.ts", 10)).toMatchObject({ pathTemplate: gemini("gemini-2.5-flash") });
    expect(at(r, "assistant.ts", 13)).toMatchObject({ pathTemplate: gemini("gemini-2.5-flash-lite"), sdk: { chain: "definePrompt" } });
    expect(at(r, "flows.ts", 8)).toMatchObject({ provider: "google-ai", pathTemplate: gemini("gemini-2.5-flash-lite", "streamGenerateContent") });
    expect(r.calls.filter((c) => c.location.file === "flows.ts" && c.location.line === 13).map((c) => c.model?.values)).toEqual([["gemini-2.5-flash-lite"], ["gemini-2.5-pro"]]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["@genkit-ai/google-genai", "ok"],
      ["@genkit-ai/googleai", "ok"],
      ["@genkit-ai/vertexai", "ok"],
    ]);
  });

  it("vertexAI(): the regional endpoint; with no model read, the one plugin's endpoint, else an unknown provider", async () => {
    const r = await scanFixture("sdk/genkit");
    expect(at(r, "assistant.ts", 16)).toMatchObject({ provider: "google-vertex", host: "{location}-aiplatform.googleapis.com", pathTemplate: vertex("gemini-2.5-pro"), authScheme: "bearer", model: { values: ["gemini-2.5-pro"] } });
    expect(at(r, "assistant.ts", 17)).toMatchObject({ pathTemplate: vertex("text-embedding-005", "predict") });
    expect(at(r, "assistant.ts", 22)).toMatchObject({ pathTemplate: vertex("gemini-embedding-2", "embedContent") });
    expect(at(r, "assistant.ts", 18)).toMatchObject({ provider: "google-vertex", pathTemplate: vertex("{model}"), model: { values: [], dynamic: true } });
    expect(at(r, "assistant.ts", 21)).toMatchObject({ provider: "unknown", sdk: { package: "genkit" } });
    expect(at(r, "assistant.ts", 21).model).toBeUndefined();
    // models the plugins send elsewhere than generateContent
    expect(at(r, "assistant.ts", 23)).toMatchObject({ provider: "google-ai", pathTemplate: gemini("veo-3.0-generate-001", "predictLongRunning") });
    expect(at(r, "assistant.ts", 24)).toMatchObject({ provider: "google-vertex", pathTemplate: vertex("imagen-4.0-generate-001", "predict") });
  });

  it("the legacy @genkit-ai/googleai and @genkit-ai/vertexai: exported model constants, prefixed names", async () => {
    const r = await scanFixture("sdk/genkit");
    expect(at(r, "legacy.ts", 6)).toMatchObject({ provider: "google-ai", pathTemplate: gemini("gemini-1.5-flash"), model: { values: ["gemini-1.5-flash"] }, sdk: { package: "@genkit-ai/googleai" } });
    expect(at(r, "legacy.ts", 7)).toMatchObject({ pathTemplate: gemini("text-embedding-004", "embedContent") });
    expect(at(r, "legacy.ts", 8)).toMatchObject({ provider: "google-vertex", pathTemplate: vertex("gemini-2.0-flash-001"), sdk: { package: "@genkit-ai/vertexai" } });
    // the configured plugin of that prefix
    expect(at(r, "legacy.ts", 9)).toMatchObject({ provider: "google-vertex", pathTemplate: vertex("gemini-2.5-flash"), sdk: { package: "@genkit-ai/vertexai" } });
  });
});
