import { describe, expect, it } from "vitest";
import { modelFromShape, modelOf } from "../../src/model/fact.js";
import { routeOf, routePath, splitModel } from "../../src/model/route.js";

describe("modelOf", () => {
  it("reads a literal, an env var default and an unreadable branch from the body", () => {
    const body = {
      type: "object" as const,
      required: ["model"],
      properties: { model: { type: "union" as const, anyOf: [{ type: "string" as const, enum: ["gpt-4o"], env: "CHAT_MODEL" }, { type: "dynamic" as const, origin: "param" as const, hint: "name" }] } },
    };
    expect(modelOf({ body, pathTemplate: "/v1/chat/completions", dynamic: [] })).toEqual({ values: ["gpt-4o"], env: "CHAT_MODEL", dynamic: true, hint: "name", sources: [{ value: "gpt-4o", from: "default" }], from: "body" });
  });

  it("prefers an explicit model to the body", () => {
    const body = { type: "object" as const, required: [], properties: { model: { type: "string" as const, enum: ["a"] } } };
    expect(modelOf({ model: { type: "string", enum: ["b"] }, body, pathTemplate: "/", dynamic: [] })?.values).toEqual(["b"]);
  });

  it("reads the path segment after models/, dropping an action but not a version", () => {
    expect(modelOf({ pathTemplate: "/v1beta/models/gemini-2.0-flash:generateContent", dynamic: [] })).toEqual({ values: ["gemini-2.0-flash"], dynamic: false, from: "path" });
    expect(modelOf({ pathTemplate: "/model/anthropic.claude-3-haiku-20240307-v1:0/converse", dynamic: [] })?.values).toEqual(["anthropic.claude-3-haiku-20240307-v1:0"]);
  });

  it("follows a path placeholder to its dynamic part, and knows nothing of a literal kept as a placeholder", () => {
    const dynamic = [{ where: "path" as const, name: "model", origin: "env", shape: { type: "string" as const, env: "MODEL" } }];
    expect(modelOf({ pathTemplate: "/v1beta/models/{model}:generateContent", dynamic })).toEqual({ values: [], env: "MODEL", dynamic: false, from: "path" });
    expect(modelOf({ pathTemplate: "/v1beta/models/{model}:generateContent", dynamic: [] })).toBeUndefined();
  });

  it("says nothing when there is no model", () => {
    expect(modelOf({ pathTemplate: "/v1/customers", dynamic: [] })).toBeUndefined();
    expect(modelFromShape(undefined, "body")).toBeUndefined();
  });
});

describe("model routes", () => {
  it("splits a known prefix only", () => {
    expect(splitModel("anthropic/claude-sonnet-4")).toEqual({ prefix: "anthropic", model: "claude-sonnet-4" });
    expect(splitModel("openai:gpt-4o")).toEqual({ prefix: "openai", model: "gpt-4o" });
    expect(splitModel("meta-llama/llama-3-8b")).toEqual({ model: "meta-llama/llama-3-8b" });
    expect(splitModel("qwen3:32b")).toEqual({ model: "qwen3:32b" });
  });

  it("routes by prefix, then by family, and nowhere for an unknown name", () => {
    expect(routeOf("groq/llama-3.3-70b")?.provider).toBe("groq");
    expect(routeOf("claude-3-5-sonnet-latest")?.provider).toBe("anthropic");
    expect(routeOf("o3-mini")?.provider).toBe("openai");
    expect(routeOf("gemini-2.5-pro")?.host).toBe("generativelanguage.googleapis.com");
    expect(routeOf("my-finetune")).toBeUndefined();
  });

  it("gives an operation its own path, and none when the route lacks it", () => {
    const openai = routeOf("gpt-4o")!;
    expect(routePath(openai, "createEmbedding")).toBe("/v1/embeddings");
    expect(routePath(openai, undefined)).toBe("/v1/chat/completions");
    expect(routePath(routeOf("claude-3-haiku")!, "createEmbedding")).toBeUndefined();
  });
});
