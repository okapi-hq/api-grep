import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();

describe("LangChain hosted-model integrations (Python)", () => {
  const hosted = scanFixture("python/sdk/langchain-hosted");

  it("langchain-fireworks: chat, completions and embeddings, a chat base URL replacing /inference", async () => {
    const r = await hosted;
    expect(at(r, "fireworks_models.py", 5)).toMatchObject({ provider: "fireworks", method: "POST", host: "api.fireworks.ai", pathTemplate: "/inference/v1/chat/completions", model: { values: ["accounts/fireworks/models/llama-v3p1-70b-instruct"] } });
    expect(keys(at(r, "fireworks_models.py", 5))).toEqual(["max_tokens", "model", "temperature"]);
    // the SDK posts to `/v1/chat/completions` under a base URL the code gives
    expect(at(r, "fireworks_models.py", 7)).toMatchObject({ host: "llm-gw.harborlane.dev", pathTemplate: "/fireworks/v1/chat/completions", model: { values: ["accounts/fireworks/models/qwen3-8b"] } });
    expect(at(r, "fireworks_models.py", 9)).toMatchObject({ pathTemplate: "/inference/v1/completions", sdk: { chain: "Fireworks" } });
    expect(at(r, "fireworks_models.py", 11)).toMatchObject({ pathTemplate: "/inference/v1/embeddings", model: { values: ["nomic-ai/nomic-embed-text-v1.5"] } });
  });

  it("langchain-together: chat, completions and embeddings under the base URL", async () => {
    const r = await hosted;
    expect(at(r, "together_models.py", 3)).toMatchObject({ provider: "together", host: "api.together.xyz", pathTemplate: "/v1/chat/completions", model: { values: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] } });
    expect(at(r, "together_models.py", 5)).toMatchObject({ host: "localhost:9300", pathTemplate: "/v1/chat/completions" });
    expect(at(r, "together_models.py", 7)).toMatchObject({ pathTemplate: "/v1/completions", model: { values: ["mistralai/Mixtral-8x7B-v0.1"] } });
    expect(at(r, "together_models.py", 9)).toMatchObject({ pathTemplate: "/v1/embeddings" });
  });

  it("langchain-huggingface: endpoints, the chat model over an endpoint, nothing for local pipelines", async () => {
    const r = await hosted;
    const hf = r.calls.filter((c) => c.location.file === "hf_models.py");
    expect(hf.map((c) => c.location.line)).toEqual([9, 11, 14, 16, 18, 20, 27]);
    expect(at(r, "hf_models.py", 9)).toMatchObject({ provider: "huggingface", host: "router.huggingface.co", pathTemplate: "/hf-inference/models/{model}", model: { values: ["mistralai/Mistral-7B-Instruct-v0.3"] } });
    // `endpoint_url` (or a URL as `model`) is where the request goes
    expect(at(r, "hf_models.py", 11)).toMatchObject({ host: "tgi.internal.harborlane.dev:8080", pathTemplate: "/" });
    expect(at(r, "hf_models.py", 14)).toMatchObject({ host: "router.huggingface.co", pathTemplate: "/v1/chat/completions", model: { values: ["meta-llama/Llama-3.1-8B-Instruct"] } });
    expect(at(r, "hf_models.py", 16)).toMatchObject({ host: "abc123.us-east-1.aws.endpoints.huggingface.cloud", pathTemplate: "/v1/chat/completions" });
    expect(at(r, "hf_models.py", 18)).toMatchObject({ pathTemplate: "/hf-inference/models/{model}/pipeline/feature-extraction", model: { values: ["sentence-transformers/all-MiniLM-L6-v2"] } });
    expect(at(r, "hf_models.py", 20)).toMatchObject({ host: "tei.internal.harborlane.dev:8081" });
    expect(at(r, "hf_models.py", 27)).toMatchObject({ pathTemplate: "/v1/chat/completions", sdk: { chain: "ChatHuggingFace.from_model_id" }, model: { values: ["HuggingFaceH4/zephyr-7b-beta"] } });
  });

  it("coverage: the three packages are read", async () => {
    const r = await hosted;
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["langchain-fireworks", "ok"],
      ["langchain-huggingface", "ok"],
      ["langchain-together", "ok"],
    ]);
  });
});
