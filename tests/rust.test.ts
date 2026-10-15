import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** The properties of a call's object body. */
const props = (c: Call | undefined): Record<string, unknown> => (c?.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

describe("rust: reqwest", () => {
  it("reads verb and request(method, url) calls, builder steps, json!, serde structs, forms, query pairs and client defaults", async () => {
    const r = await scanFixture("rust/reqwest");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "rust" && c.client === "reqwest")).toBe(true);
    expect(at(r, "chat.rs", 35)).toMatchObject({ method: "POST", provider: "anthropic", hostKind: "const", pathTemplate: "/v1/messages", authScheme: "apikey", headerValues: { "anthropic-version": "2023-06-01" } });
    expect(Object.keys(props(at(r, "chat.rs", 35)))).toEqual(["model", "max_tokens", "messages"]);
    expect(at(r, "chat.rs", 35).model?.values).toEqual(["claude-sonnet-4-5"]);
    // a `Lazy` static with an env read and its default; a key added to the json! value afterwards
    expect(at(r, "chat.rs", 54)).toMatchObject({ provider: "groq", hostKind: "env", envName: "GROQ_BASE_URL", authScheme: "bearer" });
    expect(props(at(r, "chat.rs", 54))).toHaveProperty("stream");
    // a struct serde serializes: renamed fields, `rename_all`, `skip`, an optional field
    const gemini = at(r, "chat.rs", 63);
    expect(gemini).toMatchObject({ provider: "google-ai", headers: ["content-type", "x-goog-api-key"], model: { values: ["gemini-2.5-flash"] } });
    expect(Object.keys(props(gemini))).toEqual(["contents", "maxOutputTokens", "temperature"]);
    expect((gemini.body as { required: string[] }).required).toEqual(["contents", "maxOutputTokens"]);
    expect(at(r, "chat.rs", 76)).toMatchObject({ provider: "deepseek", method: "POST", authScheme: "bearer", headers: ["authorization"] });
    expect(at(r, "notify.rs", 9)).toMatchObject({ provider: "telegram", pathTemplate: "/bot{TELEGRAM_TOKEN}/sendMessage", bodyEncoding: "form" });
    expect(at(r, "notify.rs", 18)).toMatchObject({ provider: "slack", hostKind: "env", bodyEncoding: "json" });
    expect(at(r, "notify.rs", 27)).toMatchObject({ provider: "twilio", pathTemplate: "/2010-04-01/Accounts/{sid}/Messages.json", authScheme: "basic", bodyEncoding: "form" });
    expect(Object.keys(props(at(r, "notify.rs", 27)))).toEqual(["To", "From", "Body"]);
    expect(at(r, "notify.rs", 36)).toMatchObject({ method: "GET", provider: "www.githubstatus.com", hostKind: "literal" });
    // `default_headers` and `user_agent` of the client builder are the client's parts
    const issues = at(r, "github.rs", 22);
    expect(issues).toMatchObject({ provider: "github", pathTemplate: "/repos/{owner}/{repo}/issues", query: ["state", "per_page", "page"], authScheme: "bearer" });
    expect(issues.clientParts?.map((p) => p.name)).toEqual(["authorization", "accept", "user-agent"]);
    expect(at(r, "github.rs", 32)).toMatchObject({ pathTemplate: "/user", via: "wrapper:GitHub.get" });
    // a request built in two branches from one start: the headers and query of either
    expect(at(r, "github.rs", 42)).toMatchObject({ pathTemplate: "/search/issues", query: ["q", "sort"] });
  });
});

describe("rust: ureq", () => {
  it("reads ureq 2 and 3 requests: verb functions, agents, headers, query parameters and bodies", async () => {
    const r = await scanFixture("rust/ureq");
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.client, c.provider, c.method, c.urlTemplate, c.bodyEncoding])).toEqual([
      ["agent3.rs", 6, "ureq", "hc-ping.com", "POST", "https://hc-ping.com/{uuid}", "raw"],
      ["agent3.rs", 11, "ureq", "api.pushover.net", "POST", "https://api.pushover.net/1/messages.json", "json"],
      ["agent3.rs", 18, "ureq", "status.example-cdn.net", "GET", "https://status.example-cdn.net/api/v1/status", "none"],
      ["embed.rs", 18, "ureq", "mistral", "POST", "https://api.mistral.ai/v1/embeddings", "json"],
      ["embed.rs", 29, "ureq", "api.voyageai.com", "POST", "https://api.voyageai.com/v1/embeddings", "json"],
      ["embed.rs", 37, "ureq", "open-meteo", "GET", "https://api.open-meteo.com/v1/forecast", "none"],
      ["embed.rs", 46, "ureq", "api.buttondown.email", "POST", "https://api.buttondown.email/v1/subscribers", "form"],
    ]);
    // `url.unwrap_or(DEFAULT.to_owned())`: the default, a constant; the body serialized with `serde_json::to_vec`
    expect(at(r, "embed.rs", 18)).toMatchObject({ hostKind: "const", authScheme: "bearer", model: { values: ["mistral-embed"] } });
    expect(at(r, "embed.rs", 37).query).toEqual(["latitude", "longitude"]);
    expect(Object.keys(props(at(r, "embed.rs", 46)))).toEqual(["email_address", "tags"]);
  });
});

describe("rust: awc, surf, isahc and URL joins", () => {
  it("reads the other clients and URLs joined at run time", async () => {
    const r = await scanFixture("rust/clients");
    expect(r.calls.map((c) => [c.location.line, c.client, c.method, c.urlTemplate, c.bodyEncoding])).toEqual([
      [13, "reqwest", "GET", "https://api.mailchimp.com/3.0/lists", "none"],
      [15, "reqwest", "DELETE", "https://api.mailroom.example/v2/items", "none"],
      [16, "reqwest", "POST", "https://api.openai.com/v1/responses", "json"],
      [17, "reqwest", "POST", "{env:HOOK_URL}", "none"],
      [23, "awc", "POST", "https://api.sendgrid.com/v3/mail/send", "json"],
      [27, "surf", "POST", "https://api.resend.com/emails", "json"],
      [32, "isahc", "POST", "https://api.postmarkapp.com/email", "json"],
      [33, "isahc", "GET", "https://api.ipify.org", "none"],
    ]);
    expect(at(r, "clients.rs", 23).headers).toEqual(["authorization"]);
    expect(at(r, "clients.rs", 17)).toMatchObject({ provider: "hooks.mailroom.example", hostKind: "env" });
  });
});

describe("rust: SDK registries", () => {
  it("reads async-openai builders and configs, openai-api-rs requests, teloxide and serenity calls", async () => {
    const r = await scanFixture("rust/sdk");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.provider, c.urlTemplate, c.model?.values])).toEqual([
      ["bots.rs", 8, "telegram", "https://api.telegram.org/bot{token}/sendMessage", undefined],
      ["bots.rs", 15, "telegram", "https://api.telegram.org/bot{token}/sendDice", undefined],
      ["bots.rs", 27, "discord", "https://discord.com/api/v10/channels/{channel_id}/messages", undefined],
      ["bots.rs", 30, "discord", "https://discord.com/api/v10/channels/{channel_id}/messages", undefined],
      ["openai_api.rs", 21, "together", "https://api.together.xyz/v1/chat/completions", ["gpt-4o-mini"]],
      ["openai.rs", 17, "openai", "https://api.openai.com/v1/chat/completions", ["gpt-4o-mini"]],
      ["openai.rs", 25, "openai", "https://api.openai.com/v1/embeddings", ["text-embedding-3-small"]],
      ["openai.rs", 31, "openai", "https://api.openai.com/v1/images/generations", ["dall-e-3"]],
      ["openai.rs", 44, "openrouter", "{env:OPENROUTER_BASE_URL}/chat/completions", ["anthropic/claude-sonnet-4.5"]],
      ["openai.rs", 62, "deepseek", "https://api.deepseek.com/v1/chat/completions", ["deepseek-chat"]],
    ]);
    // a constructor's arguments, a field set afterwards, a model constant imported by name
    expect(Object.keys(props(at(r, "openai_api.rs", 21)))).toEqual(["model", "messages", "temperature"]);
    // a message builder is a message with its role
    const messages = props(at(r, "openai.rs", 17)).messages as { items: { anyOf: { properties: { role: unknown } }[] } };
    expect(messages.items.anyOf.map((m) => m.properties.role)).toEqual([{ type: "string", enum: ["system"] }, { type: "string", enum: ["user"] }]);
    expect(Object.keys(props(at(r, "bots.rs", 8)))).toEqual(["chat_id", "text"]);
    expect(props(at(r, "bots.rs", 27))).toEqual({ content: { type: "string", enum: ["Pong!"] } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status])).toEqual([
      ["async-openai", "cargo", "ok"],
      ["openai-api-rs", "cargo", "ok"],
      ["serenity", "cargo", "ok"],
      ["teloxide", "cargo", "ok"],
    ]);
    expect(at(r, "openai.rs", 17).sdk).toMatchObject({ package: "async-openai", version: "0.28.3" });
  });
});

describe("rust: a workspace of several crates", () => {
  it("follows modules (crate::, super::, use, inline mod), impl blocks across files, other crates and wrappers", async () => {
    const r = await scanFixture("rust/project", { exclude: [] });
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider} ${c.method} ${c.urlTemplate}${c.via ? ` (${c.via})` : ""}`)).toMatchSnapshot();
    const ask = at(r, "crates/app/src/main.rs", 6);
    expect(ask).toMatchObject({ provider: "groq", urlTemplate: "https://api.groq.com/openai/v1/chat/completions", authScheme: "bearer", model: { values: ["llama-3.3-70b-versatile"] } });
    expect(at(r, "crates/core/src/notify.rs", 5)).toMatchObject({ provider: "pagerduty", hostKind: "const", bodyEncoding: "json" });
    expect(at(r, "crates/app/src/bin/digest.rs", 7)).toMatchObject({ provider: "postmark", headers: ["x-postmark-server-token"] });
    // `#[cfg(test)]` modules, `tests/` and `target/` are out of scope
    expect(r.calls.some((c) => c.urlTemplate?.includes("example.invalid"))).toBe(false);
    expect(r.diagnostics?.languages).toEqual({ rust: { filesSeen: 9, filesScanned: 9 } });
    // `x.workspace = true` reads the workspace's version
    expect(at(r, "crates/core/src/llm/moderation.rs", 5).sdk).toMatchObject({ package: "async-openai", version: "0.28.3" });
  });

  it("reports nothing for servers, channels, maps and response reads; skips test code, benches, target, vendor and build.rs", async () => {
    const r = await scanFixture("rust/negative", { exclude: [] });
    expect(r.calls).toEqual([]);
    // `tests/`, `benches/`, `target/`, `vendor/`, `build.rs` and `*_tests.rs` are not read; `src/store/fixtures.rs`, a
    // `#[cfg(test)] mod`, is read for its names only
    expect(r.diagnostics?.languages).toEqual({ rust: { filesSeen: 4, filesScanned: 4 } });
  });
});
