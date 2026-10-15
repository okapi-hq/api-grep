import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

/** Shapes real code gives LLM SDK calls that used to leave the SDK `imported-no-calls`. */
describe("LLM SDK call shapes: Python", () => {
  it("python: helpers that run the method, option copies, getters, properties and injected clients", async () => {
    const r = await scanFixture("python/sdk/llm-shapes");
    const line = (file: string, n: number): [string, string | undefined] => {
      const c = at(r, file, n);
      return [c.pathTemplate, c.model?.values[0]];
    };
    // `asyncio.to_thread(fn, **kw)`, `run_in_executor(None, partial(fn, ...))`
    expect(line("helpers.py", 8)).toEqual(["/v1/messages", "claude-sonnet-4-5"]);
    expect(line("helpers.py", 12)).toEqual(["/v1beta/models/gemini-2.5-flash:generateContent", "gemini-2.5-flash"]);
    expect(line("helpers.py", 18)).toEqual(["/v1/messages", "claude-haiku-4-5"]);
    expect(line("helpers.py", 23)).toEqual(["/v1/embeddings", "text-embedding-3-small"]);
    // `client.with_options(...)`, `getattr(obj, "create")`
    expect(line("helpers.py", 27)).toEqual(["/v1/chat/completions", "gpt-4o-mini"]);
    expect(line("helpers.py", 32)).toEqual(["/v1/chat/completions", "gpt-4.1"]);
    // a getter returning either SDK's client: the one whose registry has the method
    expect(at(r, "service.py", 28)).toMatchObject({ provider: "anthropic", pathTemplate: "/v1/messages" });
    expect(at(r, "service.py", 31)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions" });
    // `@property` and `@cached_property` clients, a dataclass field's `default_factory`
    expect(line("service.py", 38)).toEqual(["/v1/messages", "claude-haiku-4-5"]);
    expect(line("service.py", 45)).toEqual(["/v1/embeddings", "text-embedding-3-large"]);
    expect(at(r, "service.py", 53)).toMatchObject({ provider: "openai", pathTemplate: "/v1/moderations" });
    // FastAPI `Depends(...)`: what the dependency returns or yields, typed or not
    expect(line("api.py", 19)).toEqual(["/v1/chat/completions", "gpt-4o"]);
    expect(line("api.py", 24)).toEqual(["/v1/responses", "gpt-4.1-mini"]);
    expect(line("api.py", 29)).toEqual(["/v1/embeddings", "text-embedding-3-small"]);
    // the repository's own `agents/` package is not the openai-agents SDK
    expect(r.coverage?.sdks.find((s) => s.package === "openai-agents")).toMatchObject({ status: "declared-not-imported", importSites: 0 });
  });

  it("python: clients of two SDKs behind one getter or field, and clients handed to helpers", async () => {
    const r = await scanFixture("python/sdk/llm-clients");
    const providers = (file: string, line: number): string[] => r.calls.filter((c) => c.location.file === file && c.location.line === line).map((c) => c.provider);
    // a base class's lazy getter building AsyncAnthropic or AsyncOpenAI (imported in the function), used by a subclass
    expect(providers("a_agents.py", 30)).toEqual(["anthropic"]);
    expect(providers("a_agents.py", 32)).toEqual(["openai"]);
    expect(providers("a_agents.py", 38)).toEqual(["anthropic", "openai"]);
    // one `self._client` set to either SDK's client: the method picks it, the model's values are every default
    expect(at(r, "d_provider.py", 26)).toMatchObject({ provider: "anthropic", model: { values: ["gemini-2.5-flash-lite", "claude-sonnet-4-6", "gpt-5-mini"] } });
    expect(at(r, "d_provider.py", 31)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions" });
    // a client passed down from a caller, also through `executor.submit(fn, client, ...)`; its base URL is a parameter
    expect(at(r, "b_loop.py", 13)).toMatchObject({ clientFrom: "caller", hostKind: "unknown" });
    expect(at(r, "b_loop.py", 25)).toMatchObject({ clientFrom: "caller", hostKind: "unknown" });
    // `except ImportError: OpenAI = None` does not hide the import from the caller's client
    expect(at(r, "b_fallback.py", 9)).toMatchObject({ clientFrom: "caller", hostKind: "unknown" });
    expect(at(r, "c_alias.py", 36)).toMatchObject({ provider: "anthropic", model: { values: ["claude-3-5-sonnet-20241022"] } });
  });

});

describe("LLM SDK call shapes: TypeScript and coverage", () => {
  it("typescript: lazily built clients and the parse, stream and beta methods", async () => {
    const r = await scanFixture("sdk/llm-shapes");
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.sdk?.chain])).toEqual([
      ["calls.ts", 3, "chat.completions.parse"],
      ["calls.ts", 5, "chat.completions.stream"],
      ["calls.ts", 7, "beta.chat.completions.parse"],
      ["calls.ts", 9, "responses.stream"],
      ["calls.ts", 11, "chat.completions.runTools"],
      ["calls.ts", 13, "beta.messages.parse"],
      ["calls.ts", 15, "beta.messages.create"],
      ["clients.ts", 27, "models.generateContent"],
    ]);
    expect(at(r, "clients.ts", 27).model?.values).toEqual(["gemini-2.5-flash"]);
    expect(r.coverage?.sdks.every((s) => s.status === "ok")).toBe(true);
  });

  it("coverage leaves out imports in test directories and test runner configuration", async () => {
    const r = await scanFixture("coverage-test-dirs", { exclude: [] });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status, s.importSites])).toEqual([
      ["@google/genai", "declared-not-imported", 0],
      ["openai", "declared-not-imported", 0],
      ["anthropic", "declared-not-imported", 0],
    ]);
  });
});
