import { describe, expect, it } from "vitest";
import { scanFixture } from "./fixture-helpers.js";
import type { Report } from "../src/report/schema.js";

/** Calls as `file:line provider clientFrom`, in report order. */
const summary = (r: Report): string[] => r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider}${c.via ? ` (${c.via})` : ""} ${c.clientFrom ?? "-"}`);

describe.each([
  { lang: "python", dir: "python/receiver", provider: "anthropic" },
  { lang: "typescript", dir: "sdk/receiver", provider: "openai" },
])("$lang: an SDK client passed as an untyped parameter (#37)", ({ dir, provider }) => {
  it("follows the one caller, and reports the call through the helper at the caller too", async () => {
    const r = await scanFixture(`${dir}/one-caller`);
    expect(r.calls[0]).toMatchObject({ provider, clientFrom: "caller", client: "sdk" });
    expect(r.calls.filter((c) => c.clientFrom === "caller")).toHaveLength(1);
    expect(r.calls.filter((c) => c.via?.startsWith("wrapper:"))).toHaveLength(1);
    expect(r.diagnostics?.unfollowed).toEqual([]);
  });

  it("gives one call when every caller passes the same client", async () => {
    const r = await scanFixture(`${dir}/same-client`);
    const inHelper = r.calls.filter((c) => c.clientFrom === "caller");
    expect(inHelper).toHaveLength(1);
    expect(inHelper[0]).toMatchObject({ provider: "openai", host: "api.openai.com", pathTemplate: "/v1/chat/completions" });
  });

  it("gives one call per distinct client, each with its own provider and host", async () => {
    const r = await scanFixture(`${dir}/different-clients`);
    const inHelper = r.calls.filter((c) => c.clientFrom === "caller");
    expect(inHelper.map((c) => [c.provider, c.host, c.pathTemplate])).toEqual([
      ["openai", "api.openai.com", "/v1/chat/completions"],
      ["groq", "api.groq.com", "/openai/v1/chat/completions"],
    ]);
    expect(new Set(inHelper.map((c) => c.id)).size).toBe(2);
  });

  it("falls back to the one SDK the manifest declares with that method", async () => {
    const r = await scanFixture(`${dir}/manifest`);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ provider: "anthropic", pathTemplate: "/v1/messages", clientFrom: "manifest" });
  });

  it("lists the call as not followed when several declared SDKs have the method", async () => {
    const r = await scanFixture(`${dir}/ambiguous`);
    expect(r.calls).toEqual([]);
    expect(r.diagnostics?.unfollowed).toEqual([{ file: expect.any(String) as string, line: 2, reason: "receiver-unknown", expr: "client.chat.completions.create" }]);
    expect(r.diagnostics?.complete).toBe(false);
  });
});

describe("receiver details", () => {
  it("python: binds a constructor parameter stored on self to what the class's callers pass", async () => {
    const r = await scanFixture("python/receiver/constructor");
    expect(summary(r)).toEqual(["bot.py:9 anthropic caller"]);
  });

  it("php: follows the same helper shape (`function ask($client, $prompt)`)", async () => {
    const caller = await scanFixture("php/receiver/one-caller");
    expect(summary(caller)).toEqual(["Ask.php:9 openai caller", "Ask.php:15 openai (wrapper:ask) -"]);
    const manifest = await scanFixture("php/receiver/manifest");
    expect(summary(manifest)).toEqual(["Tagger.php:9 anthropic manifest"]);
  });

  it("keeps the helper's own arguments dynamic in the call made inside it", async () => {
    const r = await scanFixture("python/receiver/one-caller");
    expect(summary(r)).toEqual(["app.py:5 anthropic caller", "app.py:14 anthropic (wrapper:ask) -"]);
    expect(JSON.stringify(r.calls[0]!.body)).not.toContain("hello");
    expect(JSON.stringify(r.calls[1]!.body)).toContain("hello");
  });
});
