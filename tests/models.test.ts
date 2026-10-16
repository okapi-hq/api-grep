import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("models: python", () => {
  it("reads model names through env defaults, settings, function returns and branches", async () => {
    const r = await scanFixture("python/models");
    expect(r).toMatchSnapshot();
    expect(at(r, "direct.py", 13).model).toEqual({ values: ["gpt-4.1"], env: "CHAT_MODEL", dynamic: false, sources: [{ value: "gpt-4.1", from: "default" }], from: "body" });
    expect(at(r, "direct.py", 17).model).toMatchObject({ values: ["gpt-4o-mini"], env: "SUMMARY_MODEL" });
    expect(at(r, "direct.py", 21).model).toMatchObject({ values: ["whisper-1"], env: "TRANSCRIBE_MODEL" });
    expect(at(r, "direct.py", 25).model).toMatchObject({ values: ["o3-mini"], env: "REASONING_MODEL" });
    expect(at(r, "direct.py", 30).model?.values).toEqual(["claude-3-haiku-20240307", "claude-3-5-sonnet-20241022"]);
    expect(at(r, "direct.py", 34).model).toMatchObject({ values: ["gpt-3.5-turbo"], env: "FALLBACK_MODEL", dynamic: true, hint: "name" });
    expect(at(r, "direct.py", 38).model).toEqual({ values: [], dynamic: true, hint: "model_name", from: "body" });
    expect(at(r, "direct.py", 42).model?.values).toEqual(["<redacted>"]);
    expect(at(r, "direct.py", 42).model?.sources).toEqual([{ value: "<redacted>", from: "default" }]);
  });

  it("reads model clients and agents, routing libraries by model name", async () => {
    const r = await scanFixture("python/models");
    expect(at(r, "frameworks.py", 14)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions", model: { values: ["gpt-4o"] } });
    expect(Object.keys((at(r, "frameworks.py", 14).body as { properties: object }).properties)).toEqual(["model", "temperature"]);
    expect(at(r, "frameworks.py", 17)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/gemini-1.5-pro:generateContent", model: { values: ["gemini-1.5-pro"], from: "path" } });
    expect(at(r, "frameworks.py", 18).model?.values).toEqual(["anthropic.claude-3-sonnet-20240229-v1:0"]);
    expect(at(r, "frameworks.py", 19)).toMatchObject({ provider: "ollama", model: { values: ["qwen3:32b"] } });
    expect(at(r, "frameworks.py", 20)).toMatchObject({ provider: "groq", host: "api.groq.com", model: { values: ["llama-3.3-70b-versatile"], from: "argument" } });
    expect(at(r, "frameworks.py", 21)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o"] } });
    expect(at(r, "frameworks.py", 22)).toMatchObject({ provider: "openai", pathTemplate: "/v1/responses", model: { values: ["gpt-4.1-mini"] } });
    expect(at(r, "frameworks.py", 23)).toMatchObject({ provider: "anthropic", model: { values: ["claude-3-5-sonnet-20240620"] } });
    expect(at(r, "frameworks.py", 24)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o-mini"] } });
    expect(at(r, "frameworks.py", 25)).toMatchObject({ provider: "deepseek", model: { values: ["deepseek-chat"] } });
    expect(at(r, "frameworks.py", 26)).toMatchObject({ provider: "google-ai", model: { values: ["gemini-2.0-flash"] } });
    expect(at(r, "frameworks.py", 30)).toMatchObject({ provider: "mistral", model: { values: ["mistral-large-latest"] } });
    expect(at(r, "frameworks.py", 34)).toMatchObject({ provider: "openai", pathTemplate: "/v1/embeddings" });
    expect(at(r, "frameworks.py", 38)).toMatchObject({ provider: "unknown", model: { values: ["my-finetune"] } });
    expect(at(r, "wrappers.py", 9)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o-mini"] } });
    expect(at(r, "wrappers.py", 13)).toMatchObject({ provider: "ollama", pathTemplate: "/api/chat", model: { values: ["llama3.2"] } });
  });
});

describe("models: typescript", () => {
  it("reads model names through imported constants, defaults, function returns and branches", async () => {
    const r = await scanFixture("sdk/models");
    expect(r).toMatchSnapshot();
    expect(at(r, "direct.ts", 11).model).toEqual({ values: ["gpt-4.1-mini"], env: "CHAT_MODEL", dynamic: false, sources: [{ value: "gpt-4.1-mini", from: "default" }], from: "body" });
    expect(at(r, "direct.ts", 12).model).toMatchObject({ values: ["text-embedding-3-large"], env: "EMBED_MODEL" });
    expect(at(r, "direct.ts", 13).model).toMatchObject({ values: ["gpt-4o"], env: "DRAFT_MODEL" });
    expect(at(r, "direct.ts", 14).model?.values).toEqual(["gpt-4o-mini", "o3"]);
    expect(at(r, "direct.ts", 15)).toMatchObject({ provider: "groq", model: { values: ["llama-3.1-8b-instant"] } });
    expect(at(r, "direct.ts", 16)).toMatchObject({ provider: "mistral", model: { values: ["mistral-small-latest"] } });
    expect(at(r, "direct.ts", 17)).toMatchObject({ provider: "ollama", model: { values: ["llama3.2"] } });
  });

  it("reads LangChain.js clients, agents and routed names", async () => {
    const r = await scanFixture("sdk/models");
    expect(at(r, "frameworks.ts", 9)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o"] } });
    expect(Object.keys((at(r, "frameworks.ts", 9).body as { properties: object }).properties)).toEqual(["model", "temperature"]);
    expect(at(r, "frameworks.ts", 12)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/gemini-1.5-flash:generateContent" });
    expect(at(r, "frameworks.ts", 13)).toMatchObject({ provider: "ollama", model: { values: ["qwen3:32b"] } });
    expect(at(r, "frameworks.ts", 14)).toMatchObject({ provider: "anthropic", model: { values: ["claude-sonnet-4-20250514"], from: "argument" } });
    expect(at(r, "frameworks.ts", 15)).toMatchObject({ provider: "openai", pathTemplate: "/v1/responses", model: { values: ["gpt-4.1"] } });
    expect(at(r, "frameworks.ts", 16)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o-mini"] } });
    expect(at(r, "frameworks.ts", 17)).toMatchObject({ provider: "google-ai", model: { values: ["gemini-2.5-pro"] } });
  });
});

describe("models: example env files", () => {
  it("gives a model read from a variable the value its nearest example env file documents", async () => {
    const r = await scanFixture("python/env-examples", { exclude: [] });
    expect(at(r, "app.py", 9).model).toEqual({
      values: ["gpt-4o-mini"],
      env: "CHAT_MODEL",
      envExample: "gpt-4o-mini",
      dynamic: false,
      sources: [{ value: "gpt-4o-mini", from: "env_example", file: ".env.example" }],
      from: "body",
    });
    expect(at(r, "app.py", 13).model).toMatchObject({ values: ["text-embedding-3-large", "text-embedding-3-small"], env: "EMBED_MODEL", envExample: "text-embedding-3-small" });
    expect(at(r, "service/worker.py", 9).model).toMatchObject({ env: "CHAT_MODEL", envExample: "claude-sonnet-4-5" });
    // a placeholder documents nothing
    expect(at(r, "app.py", 17).model).not.toHaveProperty("envExample");
  });
});
