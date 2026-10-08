import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("provider resolution", () => {
  it("takes the provider from an env var's literal default and keeps the env var", async () => {
    const r = await scanFixture("resolve/env-default");
    expect(r).toMatchSnapshot();
    expect(at(r, "llm.ts", 4)).toMatchObject({ provider: "langdock", providerSource: "host", hostKind: "env", envName: "LANGDOCK_BASE_URL", host: "api.langdock.com", pathTemplate: "/openai/eu/v1/chat/completions" });
    expect(at(r, "llm.ts", 4).examples[0]!.url).toBe("https://api.langdock.com/openai/eu/v1/chat/completions");
    expect(at(r, "llm.ts", 7)).toMatchObject({ provider: "elevenlabs", envName: "TTS_URL", pathTemplate: "/v1/voices" });
  });

  it("takes the provider from the env var's name, with lower confidence", async () => {
    const r = await scanFixture("resolve/env-name");
    expect(r).toMatchSnapshot();
    expect(at(r, "clients.ts", 1)).toMatchObject({ provider: "openrouter", providerSource: "env-name", envName: "OPENROUTER_BASE_URL" });
    expect(at(r, "clients.ts", 3)).toMatchObject({ provider: "supabase", providerSource: "env-name" });
    expect(at(r, "clients.ts", 5)).toMatchObject({ provider: "slack", providerSource: "env-name" });
    expect(at(r, "clients.ts", 8)).toMatchObject({ provider: "env:VITE_API_URL" });
    expect(at(r, "clients.ts", 9)).toMatchObject({ provider: "env:GITHUB_CALLBACK_URL" });
    expect(at(r, "clients.ts", 1).providerSource).toBe("env-name");
    expect(at(r, "clients.ts", 1).confidence).toBeLessThan(0.3);
  });

  it("follows local helpers that build the URL", async () => {
    const r = await scanFixture("resolve/helper-url");
    expect(r).toMatchSnapshot();
    expect(at(r, "telegram.ts", 6)).toMatchObject({ provider: "telegram", host: "api.telegram.org", pathTemplate: "/bot{BOT_TOKEN}/sendMessage" });
    expect(at(r, "telegram.ts", 13)).toMatchObject({ host: "api.invoices.example.com", pathTemplate: "/v2/invoices" });
  });

  it("reads class base URLs from the constructor and parameter defaults", async () => {
    const r = await scanFixture("resolve/class-base-url");
    expect(r).toMatchSnapshot();
    expect(at(r, "gladia.ts", 9)).toMatchObject({ provider: "gladia", host: "api.gladia.io", pathTemplate: "/v2/upload" });
    expect(at(r, "gladia.ts", 17)).toMatchObject({ provider: "elevenlabs", pathTemplate: "/v1/text-to-speech/{voiceId}" });
    expect(at(r, "gladia.ts", 22)).toMatchObject({ provider: "elevenlabs", pathTemplate: "/v1/voices" });
  });

  it("never names a provider after a host template", async () => {
    const r = await scanFixture("resolve/placeholders");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => c.provider)).toEqual(["unknown", "internal", "internal", "env:REPLIT_CONNECTORS_HOSTNAME", "unknown"]);
    expect(at(r, "hosts.ts", 3)).toMatchObject({ host: "localhost:{port}", pathTemplate: "/api/items" });
    expect(at(r, "hosts.ts", 2).examples[0]!.url).toBe("http://127.0.0.1:{env:PORT}/health");
  });
});
