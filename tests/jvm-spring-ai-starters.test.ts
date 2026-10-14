import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const base = "src/main/java/com/example";
const linesOf = (r: Awaited<ReturnType<typeof scanFixture>>, file: string): number[] => r.calls.filter((c) => c.location.file === file).map((c) => c.location.line);

describe("java: more Spring AI starters, qualified beans, model enums and configuration sources (#96)", () => {
  it("reads the Azure OpenAI, Bedrock Converse, Google GenAI and DeepSeek starters", async () => {
    const r = await scanFixture("java/spring-ai-starters", { exclude: [] });
    expect(r).toMatchSnapshot();
    const azure = `azure/${base}/azure/Summaries.java`;
    expect(at(r, azure, 18)).toMatchObject({ provider: "azure-openai", envName: "spring.ai.azure.openai.endpoint", pathTemplate: "/openai/deployments/{deployment}/chat/completions", model: { values: ["notes-gpt-4o"], env: "spring.ai.azure.openai.chat.options.deployment-name" } });
    expect(at(r, azure, 22)).toMatchObject({ pathTemplate: "/openai/deployments/{deployment}/embeddings", model: { values: ["notes-embed"], env: "EMBEDDING_DEPLOYMENT" } });
    const bedrock = `bedrock/${base}/bedrock/Tickets.java`;
    const haiku = { values: ["anthropic.claude-3-5-haiku-20241022-v1:0"] };
    expect(at(r, bedrock, 16)).toMatchObject({ provider: "aws-bedrock", urlTemplate: "https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse", model: haiku });
    expect(at(r, bedrock, 20)).toMatchObject({ pathTemplate: "/model/{modelId}/converse-stream", model: haiku });
    expect(at(r, `genai/${base}/genai/Captions.java`, 15)).toMatchObject({ provider: "google-ai", urlTemplate: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", model: { values: ["gemini-2.5-flash"] } });
    // with a project, Google GenAI goes to Vertex AI: not this host, no call
    expect(linesOf(r, `genai-vertex/${base}/vertex/Labels.java`)).toEqual([]);
    // no model set: the starter's default in the declared release (1.0.3)
    expect(at(r, `deepseek/${base}/deepseek/Hints.java`, 18)).toMatchObject({ provider: "deepseek", urlTemplate: "https://api.deepseek.com/chat/completions", model: { values: ["deepseek-chat"], env: "spring.ai.deepseek.chat.options.model" } });
  });

  it("picks one of two starters by qualifier, bean name or spring.ai.model.chat, and none otherwise", async () => {
    const r = await scanFixture("java/spring-ai-starters", { exclude: [] });
    const pair = `pair/${base}/pair/Reviewer.java`;
    expect(at(r, pair, 25)).toMatchObject({ provider: "anthropic", model: { values: ["claude-sonnet-4-5"] } });
    expect(at(r, pair, 30)).toMatchObject({ provider: "openai", model: { values: ["gpt-4.1-mini"] } });
    expect(at(r, pair, 40)).toMatchObject({ provider: "openai", pathTemplate: "/v1/embeddings" });
    // the builder could be either provider's
    expect(linesOf(r, pair)).toEqual([25, 30, 40]);
    expect(at(r, `picked/${base}/picked/Answers.java`, 16)).toMatchObject({ provider: "ollama", envName: "spring.ai.ollama.base-url", model: { values: ["qwen3:14b"] } });
  });

  it("reads model enums by release, the active profile and imported files", async () => {
    const r = await scanFixture("java/spring-ai-starters", { exclude: [] });
    const catalog = `catalog/${base}/catalog/Catalog.java`;
    // MISTRAL_SMALL is mistral-small-2603 from 2.0.1 on, the BOM's release
    expect(at(r, catalog, 30).model).toEqual({ values: ["mistral-small-2603"], dynamic: false, from: "argument" });
    expect(at(r, catalog, 38).model).toMatchObject({ values: [], dynamic: true });
    expect(at(r, catalog, 45)).toMatchObject({ provider: "ollama", model: { values: ["nomic-embed-text"] } });
    expect(at(r, catalog, 50)).toMatchObject({ provider: "anthropic", model: { values: ["claude-haiku-4-5"], env: "spring.ai.anthropic.chat.model" } });
    const briefs = `profiles/${base}/profiles/Briefs.java`;
    expect(at(r, briefs, 16)).toMatchObject({ provider: "openai", envName: "spring.ai.openai.base-url", model: { values: ["gpt-4.1-mini"] } });
    expect(at(r, briefs, 16).examples[0]!.url).toBe("https://llm-proxy.example.com/v1/chat/completions");
    expect(r.coverage!.sdks.filter((s) => s.package.startsWith("org.springframework.ai")).every((s) => s.status === "ok")).toBe(true);
  });
});

describe("kotlin: Spring AI beans DSL (#96)", () => {
  it("reads ref<ChatModel>(name) in beans { }, not a project function named ref", async () => {
    const r = await scanFixture("kotlin/spring-ai-beans", { exclude: [] });
    expect(r).toMatchSnapshot();
    const app = "kennel/src/main/kotlin/com/example/kennel/KennelApplication.kt";
    expect(at(r, app, 25)).toMatchObject({ provider: "openai", model: { values: ["gpt-4o-mini"], env: "spring.ai.openai.chat.options.model" } });
    expect(at(r, app, 29)).toMatchObject({ provider: "ollama", pathTemplate: "/api/chat", model: { values: ["llama3.2"] } });
    expect(r.calls.map((c) => c.location.line)).toEqual([25, 29]);
  });
});
