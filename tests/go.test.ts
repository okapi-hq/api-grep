import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** The properties of a call's object body. */
const props = (c: Call | undefined): Record<string, unknown> => (c?.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

describe("go: net/http", () => {
  it("reads package functions, requests built with http.NewRequest and the headers and query set on them", async () => {
    const r = await scanFixture("go/nethttp");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "go" && c.client === "net-http")).toBe(true);
    expect(at(r, "notify.go", 23)).toMatchObject({ method: "GET", provider: "www.githubstatus.com", hostKind: "literal", pathTemplate: "/api/v2/status.json", bodyEncoding: "none" });
    expect(at(r, "notify.go", 28)).toMatchObject({ method: "POST", provider: "slack", hostKind: "const", bodyEncoding: "json", body: { properties: { text: { type: "string" }, channel: { enum: ["#ops"] } } } });
    expect(props(at(r, "notify.go", 28))).not.toHaveProperty("secret");
    expect(at(r, "notify.go", 34)).toMatchObject({ provider: "twilio", pathTemplate: "/2010-04-01/Accounts/{sid}/Messages.json", bodyEncoding: "form" });
    expect(at(r, "notify.go", 42)).toMatchObject({ method: "POST", provider: "pagerduty", headerValues: { "content-type": "application/json" }, bodyEncoding: "json" });
    expect(Object.keys(props(at(r, "notify.go", 42)))).toEqual(["routing_key", "event_action", "payload"]);
    expect(at(r, "notify.go", 52)).toMatchObject({ method: "GET", provider: "open-meteo", query: ["latitude", "longitude"] });
    expect(at(r, "notify.go", 66)).toMatchObject({ hostKind: "env", envName: "MAILGUN_API_BASE", pathTemplate: "/v3/{domain}/messages", authScheme: "basic", bodyEncoding: "form" });
    expect(props(at(r, "notify.go", 66))).toHaveProperty("to");
    expect(at(r, "notify.go", 74)).toMatchObject({ method: "HEAD", provider: "github" });
    // a package-level variable of another file, a field set by the constructor of another file
    expect(at(r, "linear.go", 24)).toMatchObject({ provider: "linear", hostKind: "const", authScheme: "bearer", body: { properties: { query: { type: "string" } } } });
    // go-retryablehttp keeps net/http's request API; the file ends without a newline
    expect(at(r, "retry.go", 9)).toMatchObject({ method: "POST", provider: "sentry", headers: ["x-sentry-auth"] });
  });

  it("reports nothing for servers, handlers and response reads; skips tests, testdata and vendor", async () => {
    const r = await scanFixture("go/negative", { exclude: [] });
    expect(r.calls).toEqual([]);
    expect(r.diagnostics?.languages).toEqual({ go: { filesSeen: 1, filesScanned: 1 } });
  });
});

describe("go: resty", () => {
  it("reads client settings, request settings and the verb call", async () => {
    const r = await scanFixture("go/resty");
    expect(r.calls.map((c) => [c.location.line, c.client, c.provider, c.method, c.urlTemplate, c.authScheme, c.bodyEncoding])).toEqual([
      [17, "resty", "lemonsqueezy", "GET", "https://api.lemonsqueezy.com/v1/products", "bearer", "none"],
      [22, "resty", "paddle", "POST", "https://api.paddle.com/transactions", "none", "json"],
      [31, "resty", "mailchimp", "DELETE", "https://us1.api.mailchimp.com/3.0/lists/{id}", "basic", "none"],
    ]);
    expect(at(r, "shop.go", 17).query).toEqual(["page[size]"]);
    expect(at(r, "shop.go", 22)).toMatchObject({ headers: ["content-type"], body: { properties: { amount: { type: "integer" }, currency: { enum: ["usd"] } } } });
  });
});

describe("go: SDK registries", () => {
  it("reads go-openai, openai-go, anthropic-sdk-go and genai calls with their models and base URLs", async () => {
    const r = await scanFixture("go/sdk");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.provider, c.urlTemplate, c.model?.values])).toEqual([
      ["goopenai.go", 20, "openai", "https://api.openai.com/v1/chat/completions", ["gpt-4o-mini"]],
      ["goopenai.go", 36, "openai", "https://api.openai.com/v1/embeddings", ["text-embedding-3-small"]],
      ["goopenai.go", 46, "deepseek", "https://api.deepseek.com/v1/chat/completions", ["deepseek-chat"]],
      ["goopenai.go", 53, "openrouter", "{env:OPENROUTER_BASE_URL}/chat/completions", ["openai/gpt-4o"]],
      ["official.go", 15, "openai", "https://api.openai.com/v1/chat/completions", ["gpt-4o"]],
      ["official.go", 25, "xai", "https://api.x.ai/v1/responses", ["grok-4"]],
      ["official.go", 31, "anthropic", "https://api.anthropic.com/v1/messages", ["claude-sonnet-4-5"]],
      ["official.go", 44, "google-ai", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", ["gemini-2.5-flash"]],
      ["official.go", 49, "google-ai", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", ["gemini-2.5-pro"]],
    ]);
    expect(Object.keys(props(at(r, "goopenai.go", 20)))).toEqual(["model", "max_tokens", "messages"]);
    // a field set after the struct literal (`req.Stream = true`)
    expect(props(at(r, "goopenai.go", 46))).toHaveProperty("stream");
    expect(props(at(r, "official.go", 15)).messages).toMatchObject({ type: "array" });
    // `openai.Int(512)` is the value it wraps
    expect(props(at(r, "official.go", 15)).max_tokens).toEqual({ type: "integer", enum: [512] });
    expect(at(r, "official.go", 31)).toMatchObject({ authScheme: "apikey", body: { properties: { max_tokens: { enum: [1024] } } } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status])).toEqual([
      ["github.com/anthropics/anthropic-sdk-go", "go", "ok"],
      ["github.com/openai/openai-go/v3", "go", "ok"],
      ["github.com/sashabaranov/go-openai", "go", "ok"],
      ["google.golang.org/genai", "go", "ok"],
    ]);
    expect(at(r, "goopenai.go", 20).sdk).toMatchObject({ package: "github.com/sashabaranov/go-openai", version: "v1.40.5" });
  });
});

describe("go: a module of several packages", () => {
  it("follows imports of the module's packages, methods declared across files and wrappers", async () => {
    const r = await scanFixture("go/project", { exclude: [] });
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider} ${c.method} ${c.urlTemplate}${c.via ? ` (${c.via})` : ""}`)).toMatchSnapshot();
    const ask = r.calls.find((c) => c.location.file === "cmd/bot/main.go" && c.location.line === 15)!;
    expect(ask).toMatchObject({ provider: "groq", urlTemplate: "https://api.groq.com/openai/v1/chat/completions", authScheme: "bearer", model: { values: ["llama-3.3-70b-versatile"] } });
    expect(Object.keys(props(ask))).toEqual(["model", "messages"]);
    expect(at(r, "internal/telegram/bot.go", 16)).toMatchObject({ provider: "telegram", pathTemplate: "/bot{TELEGRAM_TOKEN}/sendMessage", bodyEncoding: "form" });
    // `_test.go` files are out of scope
    expect(r.calls.some((c) => c.location.file.endsWith("_test.go"))).toBe(false);
    expect(r.diagnostics?.languages).toEqual({ go: { filesSeen: 5, filesScanned: 5 } });
  });
});
