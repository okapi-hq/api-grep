import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const OPENAI = "https://api.openai.com/v1/chat/completions";

describe("java: Spring AI clients configured by the starter and application.yml (#89)", () => {
  it("reads the provider from the declared starter and the model from the configuration or the code's options", async () => {
    const r = await scanFixture("java/spring-ai", { exclude: [] });
    expect(r).toMatchSnapshot();
    const ctl = "assistant/src/main/java/com/example/assistant/AssistantController.java";
    const configured = { values: ["gpt-4o-mini"], env: "spring.ai.openai.chat.options.model", dynamic: false };
    expect(at(r, ctl, 28)).toMatchObject({ provider: "openai", client: "sdk", method: "POST", urlTemplate: OPENAI, model: configured, sdk: { chain: "prompt.call", package: "org.springframework.ai:spring-ai-starter-model-openai" } });
    expect(at(r, ctl, 33)).toMatchObject({ urlTemplate: OPENAI, model: configured, sdk: { chain: "prompt.stream" } });
    // the prompt's options and the request's options choose the model
    expect(at(r, ctl, 39).model).toEqual({ values: ["gpt-4.1"], dynamic: false, from: "argument" });
    expect(at(r, ctl, 48)).toMatchObject({ sdk: { chain: "call" }, model: { values: ["gpt-4.1-nano"] } });
    expect(at(r, ctl, 53)).toMatchObject({ urlTemplate: "https://api.openai.com/v1/embeddings", model: { values: ["text-embedding-3-small"], env: "spring.ai.openai.embedding.options.model" } });
    // reading the response is the same request, once; a profile's model is not the default one
    expect(r.calls.filter((c) => c.location.file === ctl).map((c) => c.location.line)).toEqual([28, 33, 39, 48, 53, 58]);
    expect(r.calls.filter((c) => c.model?.env === "spring.ai.openai.chat.options.model").map((c) => c.model!.values)).toEqual([["gpt-4o-mini"], ["gpt-4o-mini"], ["gpt-4o-mini"]]);
  });

  it("reads a gateway base URL, a model from a placeholder, and models chosen by their class", async () => {
    const r = await scanFixture("java/spring-ai", { exclude: [] });
    const drafts = "gateway/src/main/java/com/example/gateway/Drafts.java";
    expect(at(r, drafts, 20)).toMatchObject({ provider: "openai", host: "llm-gateway.example.com", envName: "LLM_GATEWAY_URL", pathTemplate: "/v1/chat/completions", model: { values: ["gpt-4.1-mini"], env: "CHAT_MODEL" } });
    expect(at(r, drafts, 20).examples[0]!.url).toBe("https://llm-gateway.example.com/v1/chat/completions");
    expect(at(r, drafts, 24)).toMatchObject({ pathTemplate: "/v1/images/generations", model: { values: ["dall-e-3"] }, sdk: { package: "org.springframework.ai:spring-ai-openai-spring-boot-starter" } });
    const router = "mixed/src/main/java/com/example/mixed/Router.java";
    expect(at(r, router, 28)).toMatchObject({ provider: "ollama", pathTemplate: "/api/chat", model: { values: ["qwen3:8b"] } });
    expect(at(r, router, 32)).toMatchObject({ provider: "mistral", host: "api.mistral.ai", model: { values: ["mistral-small-latest"] } });
    // a model built in the code: its API object's base URL, its default options' model, not the properties
    expect(at(r, router, 36)).toMatchObject({ provider: "ollama", urlTemplate: "http://gpu-box.internal:11434/api/chat", model: { values: ["llama3.1:70b"] } });
    // two model starters: a ChatModel injected by its interface could be either
    expect(r.calls.some((c) => c.location.file === router && c.location.line === 41)).toBe(false);
    expect(r.coverage.sdks.filter((s) => s.package.startsWith("org.springframework.ai")).map((s) => [s.package, s.status, s.calls])).toEqual([
      ["org.springframework.ai:spring-ai-openai-spring-boot-starter", "ok", 2],
      ["org.springframework.ai:spring-ai-starter-model-mistral-ai", "ok", 1],
      ["org.springframework.ai:spring-ai-starter-model-ollama", "ok", 2],
      ["org.springframework.ai:spring-ai-starter-model-openai", "ok", 6],
    ]);
  });
});

describe("kotlin: Spring AI (#89)", () => {
  it("reads ChatClient chains on an injected builder, a mutated client and a ChatModel, and nothing without a starter", async () => {
    const r = await scanFixture("kotlin/spring-ai", { exclude: [] });
    expect(r).toMatchSnapshot();
    const svc = "tutor/src/main/kotlin/com/example/tutor/TutorService.kt";
    const configured = { values: ["claude-sonnet-4-5"], env: "spring.ai.anthropic.chat.options.model" };
    expect(at(r, svc, 14)).toMatchObject({ provider: "anthropic", urlTemplate: "https://api.anthropic.com/v1/messages", authScheme: "apikey", model: configured });
    expect(at(r, svc, 16)).toMatchObject({ sdk: { chain: "prompt.stream" }, model: configured });
    expect(at(r, svc, 19)).toMatchObject({ sdk: { chain: "call" }, model: { values: ["claude-haiku-4-5"] } });
    expect(at(r, svc, 23)).toMatchObject({ sdk: { chain: "prompt.call" }, model: configured });
    expect(r.calls).toHaveLength(4);
  });
});
