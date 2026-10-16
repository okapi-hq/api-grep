import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** Model names chosen at run time, read from defaults, example env files and config files (#125). */
const model = (c: Call): Call["model"] => c.model;
const dflt = (value: string) => ({ value, from: "default" });
const example = (value: string, file = ".env.example") => ({ value, from: "env_example", file });
const config = (value: string, file: string, key: string) => ({ value, from: "config_file", file, key });

describe("runtime models: python", () => {
  it("reads settings classes, dataclass configurations and constructor and attribute defaults", async () => {
    const r = await scanFixture("python/runtime-models");
    expect(r).toMatchSnapshot();
    // pydantic-settings: the env var after the prefix, the field's default, `Field("...")`, an alias, the example's value
    expect(model(at(r, "services.py", 51))).toMatchObject({ values: ["gpt-4o-mini"], env: "NOTES_CHAT_MODEL", sources: [dflt("gpt-4o-mini")] });
    expect(model(at(r, "services.py", 55))).toMatchObject({ values: ["gpt-4.1-mini"], env: "NOTES_SUMMARY_MODEL" });
    expect(model(at(r, "services.py", 60))).toMatchObject({ values: ["text-embedding-3-small"], env: "EMBEDDINGS" });
    expect(model(at(r, "services.py", 64))).toMatchObject({ values: ["llama-3.3-70b-versatile"], env: "NOTES_GROQ_MODEL", sources: [example("llama-3.3-70b-versatile")] });
    expect(model(at(r, "services.py", 68))).toMatchObject({ values: ["gpt-4o"], env: "LEGACY_VISION_MODEL" });
    expect(model(at(r, "services.py", 72))).toMatchObject({ values: ["claude-3-5-haiku-latest"], sources: [dflt("claude-3-5-haiku-latest")] });
    expect(model(at(r, "services.py", 77))).toMatchObject({ values: ["claude-sonnet-4-5"], sources: [dflt("claude-sonnet-4-5")] });
    // `model or self.DEFAULT_MODEL`, `model or os.environ.get(...)`, a commented-out example, a constructor default
    expect(model(at(r, "services.py", 21))).toEqual({ values: ["gpt-4.1-nano"], dynamic: true, hint: "model", sources: [dflt("gpt-4.1-nano")], from: "body" });
    expect(model(at(r, "services.py", 31))).toMatchObject({
      values: ["llama-3.1-8b-instant", "llama-3.1-70b-versatile"],
      env: "FAST_MODEL",
      dynamic: true,
      sources: [dflt("llama-3.1-8b-instant"), example("llama-3.1-70b-versatile")],
    });
    expect(model(at(r, "services.py", 47))).toMatchObject({ values: ["claude-3-7-sonnet-latest"], sources: [dflt("claude-3-7-sonnet-latest")] });
  });

  it("reads keys of dicts the code builds, `.get` defaults, config files and argparse defaults", async () => {
    const r = await scanFixture("python/runtime-models");
    expect(model(at(r, "services.py", 34))).toMatchObject({ values: ["llama-3.3-70b-versatile"], env: "FAST_FALLBACK", dynamic: true });
    expect(model(at(r, "services.py", 38))).toMatchObject({ values: ["llama-3.3-70b-versatile"], dynamic: true });
    expect(model(at(r, "services.py", 82))).toMatchObject({ values: ["gpt-4o-2024-08-06"], dynamic: true, hint: "model" });
    expect(model(at(r, "config_files.py", 18))).toEqual({ values: ["gpt-4o-mini"], dynamic: false, sources: [config("gpt-4o-mini", "config.yaml", "llm.model")], from: "body" });
    expect(model(at(r, "config_files.py", 22))?.sources).toEqual([config("text-embedding-3-large", "config.yaml", "embeddings.model")]);
    expect(model(at(r, "config_files.py", 26))?.values).toEqual(["o3"]);
    expect(model(at(r, "config_files.py", 30))?.sources).toEqual([config("gpt-4.1-nano", "models.toml", "router.model")]);
    expect(model(at(r, "cli.py", 19))).toMatchObject({ values: ["gpt-4.1"], dynamic: true, hint: "judge_model", sources: [dflt("gpt-4.1")] });
    expect(model(at(r, "cli.py", 20))).toMatchObject({ values: ["o4-mini"], hint: "grader_model" });
  });

  it("gives no value nothing flows from: other keys' defaults, unread or ambiguous examples, placeholders, unknown paths", async () => {
    const r = await scanFixture("python/runtime-models");
    expect(model(at(r, "negatives.py", 18))).toEqual({ values: [], env: "NOTES_UNDOCUMENTED", dynamic: false, from: "body" });
    expect(model(at(r, "negatives.py", 22))?.values).toEqual([]);
    expect(model(at(r, "negatives.py", 26))).toEqual({ values: [], env: "EMBED_PROVIDER_MODEL", dynamic: false, from: "body" });
    expect(model(at(r, "negatives.py", 30))?.values).toEqual([]);
    expect(model(at(r, "negatives.py", 35))?.values).toEqual([]);
    // a stand-in default (`mock-model`) and a default no model id looks like (`unknown+pipeline`)
    expect(model(at(r, "negatives.py", 44))).toEqual({ values: [], dynamic: true, from: "body" });
    expect(model(at(r, "negatives.py", 48))).toEqual({ values: [], env: "PIPELINE_ID", dynamic: true, from: "body" });
    // `FAST_FALLBACK=my-fallback-model` is a placeholder; `UNUSED_MODEL` is read by no call
    expect(model(at(r, "services.py", 34))).not.toHaveProperty("envExample");
    expect(r.calls.flatMap((c) => c.model?.values ?? [])).not.toContain("gpt-4-turbo");
    expect(r.calls.flatMap((c) => c.model?.values ?? [])).not.toContain("30");
  });
});

describe("runtime models: what reading dicts must not break", () => {
  it("keeps a generated client's wrapper expansions when its encoder reassigns a key of the dict it reads", async () => {
    // `obj_dict = obj_dict["root"]` in an encoder that calls itself: reading the key must stay bounded
    const r = await scanFixture("python/generated-client");
    expect(r.diagnostics?.droppedCalls).toEqual([]);
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.method} ${c.pathTemplate}${c.via ? ` ${c.via}` : ""}`)).toEqual([
      "http_client.py:16 DYNAMIC /{path}",
      "http_client.py:32 DYNAMIC /{path}",
      "notes.py:10 GET /v1/notes/{to_jsonable} wrapper:HttpClient.request",
      "notes.py:13 DELETE /v1/notes/{to_jsonable} wrapper:HttpClient.request",
      "notes.py:16 GET /v1/notes wrapper:HttpClient.request",
      "notes.py:19 POST /v1/notes wrapper:HttpClient.request",
      "notes.py:27 GET /v1/notes/{to_jsonable} wrapper:AsyncHttpClient.request",
      "notes.py:30 GET /v1/notes wrapper:AsyncHttpClient.request",
    ]);
  });
});

describe("runtime models: typescript and javascript", () => {
  it("reads env schemas, config files, class fields and example env files", async () => {
    const r = await scanFixture("sdk/runtime-models");
    expect(r).toMatchSnapshot();
    expect(model(at(r, "clients.ts", 21))).toMatchObject({ values: ["claude-sonnet-4-5"], env: "WRITER_MODEL", sources: [dflt("claude-sonnet-4-5")] });
    expect(model(at(r, "clients.ts", 30))).toMatchObject({ values: ["llama-3.1-8b-instant"], sources: [dflt("llama-3.1-8b-instant")] });
    expect(model(at(r, "clients.ts", 33))).toEqual({ values: ["llama-3.3-70b-versatile"], dynamic: false, from: "body" });
    expect(model(at(r, "clients.ts", 37))).toMatchObject({ values: ["gpt-4o-mini"], env: "CHAT_MODEL", sources: [dflt("gpt-4o-mini")] });
    expect(model(at(r, "clients.ts", 38))).toMatchObject({ values: ["text-embedding-3-small"], env: "EMBED_MODEL", sources: [example("text-embedding-3-small")] });
    expect(model(at(r, "clients.ts", 39))).toMatchObject({ values: ["gpt-4.1-mini"], env: "SUMMARY_MODEL" });
    expect(model(at(r, "clients.ts", 40))).toMatchObject({ values: ["gpt-4o"], env: "NOTES_VISION_MODEL", sources: [example("gpt-4o")] });
    expect(model(at(r, "clients.ts", 41))?.sources).toEqual([config("gpt-4.1", "config.json", "llm.judge")]);
    expect(model(at(r, "clients.ts", 42))?.sources).toEqual([config("o3", "settings.json", "grader"), dflt("o4-mini")]);
    expect(model(at(r, "clients.ts", 43))?.sources).toEqual([config("gpt-4.1-nano", "llm.yaml", "router.model")]);
    // two commented-out values document none
    expect(model(at(r, "clients.ts", 44))).toEqual({ values: [], env: "PLAIN_MODEL", dynamic: false, from: "body" });
  });

  it("never gives a default every caller overrides", async () => {
    // `new OpenAIService(model)`, `this.model = model ?? "gpt-5-nano"` with a model every caller passes (strict null checks)
    const r = await scanFixture("sdk/caller-model");
    expect(r).toMatchSnapshot();
    for (const line of [8, 20]) expect(model(at(r, "service.ts", line))).toEqual({ values: [], dynamic: true, hint: "model", from: "body" });
    for (const c of r.calls.filter((x) => x.via?.includes("OpenAIService") || x.via?.includes("OtherService"))) expect(c.model?.values).toEqual([]);
    // a constructor nobody gives the model keeps its default
    expect(model(at(r, "service.ts", 29))).toMatchObject({ values: ["gpt-4.1-mini"], sources: [dflt("gpt-4.1-mini")] });
    expect(model(at(r, "agent.ts", 29))).toMatchObject({ values: ["gpt-4.1-mini"] });
  });

  it("keeps a caller's literal fallback, and a default some caller lets run", async () => {
    const r = await scanFixture("sdk/caller-model");
    // `new Client(key, env.MODEL ?? "...")`: the caller's fallback; the parameter's own default runs for no caller
    expect(model(at(r, "clients.ts", 9))).toMatchObject({ values: ["claude-sonnet-4-6"], dynamic: true, sources: [dflt("claude-sonnet-4-6")] });
    expect(model(at(r, "clients.ts", 17))).toMatchObject({ values: ["gpt-4o-mini"], dynamic: true, sources: [dflt("gpt-4o-mini")] });
    // `config.model ?? "..."` with a caller handing its config through and one leaving the model out
    expect(model(at(r, "embeddings.ts", 20))).toMatchObject({ values: ["text-embedding-3-small"], dynamic: true, sources: [dflt("text-embedding-3-small")] });
    expect(model(at(r, "embeddings.ts", 28))).toMatchObject({ values: ["text-embedding-3-large"], dynamic: true, sources: [dflt("text-embedding-3-large")] });
    // `config.model ?? "..."` where the type lists the names: every one of them, and the default
    expect(model(at(r, "typed-config.ts", 23))).toEqual({
      values: ["text-embedding-3-large", "text-embedding-3-small", "text-embedding-ada-002"],
      dynamic: false,
      sources: [dflt("text-embedding-ada-002")],
      from: "body",
    });
  });

  it("reads JavaScript fields set from a preference, an env var and a default, and required JSON files", async () => {
    const r = await scanFixture("javascript/runtime-models");
    expect(model(at(r, "providers.js", 12))).toMatchObject({
      values: ["claude-sonnet-4-5", "claude-haiku-4-5"],
      env: "CLAUDE_MODEL_PREF",
      sources: [dflt("claude-sonnet-4-5"), example("claude-haiku-4-5")],
    });
    expect(model(at(r, "providers.js", 23))).toMatchObject({ values: ["llama3.2"], env: "LOCAL_MODEL_PREF", sources: [example("llama3.2")] });
    expect(model(at(r, "providers.js", 28))?.sources).toEqual([config("text-embedding-3-small", "defaults.json", "embeddings.model")]);
  });
});
