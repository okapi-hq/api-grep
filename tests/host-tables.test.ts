import { describe, expect, it } from "vitest";
import type { Call, Report } from "../src/report/schema.js";
import { scanFixture } from "./fixture-helpers.js";

/** The calls at one line, as `[provider, host, hostKind]`. */
const hostsAt = (r: Report, file: string, line: number): [string, string | undefined, string][] =>
  r.calls.filter((c) => c.location.file === file && c.location.line === line).map((c) => [c.provider, c.host, c.hostKind]);

const at = (r: Report, file: string, line: number): Call[] => r.calls.filter((c) => c.location.file === file && c.location.line === line);

describe("host tables: TypeScript", () => {
  it("reports a call once per host of the provider table its base URL is picked from", async () => {
    const r = await scanFixture("resolve/provider-tables", { examples: 0 });
    // an object of providers read with a key known at run time only, by fetch and by an OpenAI client
    expect(hostsAt(r, "a-object.ts", 13)).toEqual([
      ["openai", "api.openai.com", "const"],
      ["deepseek", "api.deepseek.com", "const"],
      ["groq", "api.groq.com", "const"],
    ]);
    expect(at(r, "a-object.ts", 19).map((c) => [c.provider, c.pathTemplate, c.sdk?.chain])).toEqual([
      ["openai", "/v1/chat/completions", "chat.completions.create"],
      ["deepseek", "/v1/chat/completions", "chat.completions.create"],
      ["groq", "/openai/v1/chat/completions", "chat.completions.create"],
    ]);
    // `Object.freeze` and a `Record<string, ...>` annotation
    expect(hostsAt(r, "a-frozen.ts", 13).map(([p]) => p)).toEqual(["mistral", "together"]);
    // the entry `LIST.find(...)` returns
    expect(hostsAt(r, "b-array.ts", 13).map(([p]) => p)).toEqual(["groq", "fireworks", "perplexity"]);
    // each copy lists every candidate host, and has an id of its own
    const copies = at(r, "a-object.ts", 13);
    expect(copies.every((c) => c.hostAlternatives?.join() === "api.openai.com,api.deepseek.com,api.groq.com")).toBe(true);
    expect(new Set(copies.map((c) => c.id)).size).toBe(3);
  });

  it("pairs each host with the model its entry names, and reads a helper's several returns", async () => {
    const r = await scanFixture("resolve/provider-tables", { examples: 0 });
    expect(at(r, "c-presets.ts", 9).map((c) => [c.provider, c.host, c.model?.values])).toEqual([
      ["deepseek", "api.deepseek.com", ["deepseek-chat"]],
      ["api.siliconflow.cn", "api.siliconflow.cn", ["Qwen/Qwen2.5-7B-Instruct"]],
      ["api.moonshot.cn", "api.moonshot.cn", ["moonshot-v1-8k"]],
    ]);
    // every return's default host, the env var kept
    expect(at(r, "f-helper.ts", 9).map((c) => [c.provider, c.hostKind, c.envName, c.host])).toEqual([
      ["google-ai", "env", "GEMINI_BASE_URL", "generativelanguage.googleapis.com"],
      ["openai", "env", "OPENAI_BASE_URL", "api.openai.com"],
    ]);
  });

  it("invents no host: a table no request reads, and one over the cap", async () => {
    const r = await scanFixture("resolve/provider-tables", { examples: 0 });
    expect(hostsAt(r, "negative-unused.ts", 14)).toEqual([["unknown", undefined, "unknown"]]);
    expect(r.calls.filter((c) => c.location.file === "negative-unused.ts")).toHaveLength(1);
    expect(hostsAt(r, "over-cap.ts", 56)).toEqual([["unknown", undefined, "unknown"]]);
    expect(r.diagnostics?.unfollowed).toEqual([{ file: "over-cap.ts", line: 56, reason: "host-table-limit", detail: "50 candidates (at most 20)" }]);
    // a key or a helper argument the code fixes picks one entry
    expect(hostsAt(r, "g-known-key.ts", 17)).toEqual([["mistral", "api.mistral.ai", "const"]]);
    expect(at(r, "g-known-key.ts", 18)).toHaveLength(1);
    // the candidate hosts are calls' hosts: host coverage counts them as explained
    const unexplained = r.coverage?.hosts?.unexplained.map((u) => u.host) ?? [];
    expect(unexplained.filter((h) => ["api.deepseek.com", "api.groq.com", "api.siliconflow.cn", "api.perplexity.ai"].includes(h))).toEqual([]);
  });
});

describe("host tables: Python, Rust, Kotlin, Go", () => {
  it("python: dataclass lists searched with next(...) or a comprehension, dicts read with [...] or .get", async () => {
    const r = await scanFixture("python/provider-tables", { examples: 0 });
    expect(at(r, "defaults.py", 29).map((c) => [c.provider, c.model?.values])).toEqual([
      ["groq", ["llama-3.3-70b-versatile"]],
      ["mistral", ["mistral-small-latest"]],
      ["together", ["meta-llama/Llama-3-8b-chat-hf"]],
    ]);
    expect(at(r, "defaults.py", 34).map((c) => [c.provider, c.client, c.model?.values[0]])).toEqual([
      ["groq", "httpx", "llama-3.3-70b-versatile"],
      ["mistral", "httpx", "mistral-small-latest"],
      ["together", "httpx", "meta-llama/Llama-3-8b-chat-hf"],
    ]);
    expect(hostsAt(r, "dicts.py", 10).map(([, h]) => h)).toEqual(["openrouter.ai", "api.deepinfra.com"]);
    expect(hostsAt(r, "dicts.py", 15).map(([, h]) => h)).toEqual(["openrouter.ai", "api.deepinfra.com"]);
    // a helper's several returns, each an env var with a default; given an argument the code fixes, no table
    expect(at(r, "helpers.py", 13).map((c) => [c.provider, c.envName, c.host])).toEqual([
      ["groq", "GROQ_BASE_URL", "api.groq.com"],
      ["mistral", "MISTRAL_BASE_URL", "api.mistral.ai"],
    ]);
    expect(at(r, "helpers.py", 18)).toHaveLength(1);
    // a table shown on a settings page, never a request's URL
    expect(hostsAt(r, "unused.py", 16)).toEqual([["unknown", undefined, "unknown"]]);
  });

  it("rust: the arms of a match a method returns, a searched array; kotlin: a searched list; go: a map and a switch's returns", async () => {
    const rust = await scanFixture("rust/provider-tables", { examples: 0 });
    for (const line of [22, 29]) expect(hostsAt(rust, "providers.rs", line).map(([p]) => p)).toEqual(["mistral", "groq", "cerebras"]);
    // the struct `iter().find(...)` returns
    expect(hostsAt(rust, "search.rs", 13).map(([p]) => p)).toEqual(["together", "fireworks"]);
    // kotlin: the data class instance `first { ... }` returns
    const kotlin = await scanFixture("kotlin/provider-tables", { examples: 0 });
    expect(hostsAt(kotlin, "Providers.kt", 16).map(([p]) => p)).toEqual(["groq", "mistral"]);
    const go = await scanFixture("go/provider-tables", { examples: 0 });
    expect(hostsAt(go, "proxy.go", 28).map(([p]) => p)).toEqual(["groq", "deepseek"]);
    expect(hostsAt(go, "proxy.go", 32).map(([p]) => p)).toEqual(["fireworks", "together", "openai"]);
    expect(at(go, "proxy.go", 39).map((c) => [c.provider, c.sdk?.package])).toEqual([
      ["groq", "github.com/sashabaranov/go-openai"],
      ["deepseek", "github.com/sashabaranov/go-openai"],
    ]);
  });
});
