import { describe, expect, it } from "vitest";
import { defaultRegistry } from "../../src/detect/registry/index.js";
import { isLocalhost, PROVIDERS, providerForHost, providerFromEnvName, resolveProvider } from "../../src/normalize/provider.js";

describe("providers.json", () => {
  it("has unique ids and names every registry provider", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of defaultRegistry().entries()) expect(ids).toContain(e.provider);
  });

  it("maps the hosts found in the evaluation to brand ids", () => {
    const hosts: Record<string, string> = {
      "api.langdock.com": "langdock",
      "ai.gateway.lovable.dev": "lovable-ai-gateway",
      "api.elevenlabs.io": "elevenlabs",
      "api.gladia.io": "gladia",
      "graph.facebook.com": "meta-graph",
      "api.pwnedpasswords.com": "hibp",
      "www.virustotal.com": "virustotal",
      "api.x.ai": "xai",
      "api.deepseek.com": "deepseek",
      "api.together.xyz": "together",
      "api.fireworks.ai": "fireworks",
      "api.cohere.com": "cohere",
      "api.replicate.com": "replicate",
      "huggingface.co": "huggingface",
      "api-inference.huggingface.co": "huggingface",
      "firestore.googleapis.com": "firebase",
      "identitytoolkit.googleapis.com": "firebase",
      "my-worker.acme.workers.dev": "cloudflare-workers",
    };
    for (const [host, id] of Object.entries(hosts)) expect(providerForHost(host), host).toBe(id);
  });

  it("prefers an exact host, then the longest suffix", () => {
    expect(providerForHost("maps.googleapis.com")).toBe("google-maps");
    expect(providerForHost("generativelanguage.googleapis.com")).toBe("google-ai");
    expect(providerForHost("sheets.googleapis.com")).toBe("google");
    expect(providerForHost("API.Stripe.com:443")).toBe("stripe");
    expect(providerForHost("{hostname}.stripe.com")).toBeUndefined();
  });
});

describe("providerFromEnvName", () => {
  it("strips framework prefixes and URL suffixes", () => {
    expect(providerFromEnvName("OPENROUTER_BASE_URL")).toBe("openrouter");
    expect(providerFromEnvName("LANGDOCK_ENDPOINT_URL")).toBe("langdock");
    expect(providerFromEnvName("GLADIA_API_URL")).toBe("gladia");
    expect(providerFromEnvName("NEXT_PUBLIC_SUPABASE_URL")).toBe("supabase");
    expect(providerFromEnvName("VITE_POSTHOG_HOST")).toBe("posthog");
    expect(providerFromEnvName("SLACK_WEBHOOK_URL")).toBe("slack");
    expect(providerFromEnvName("SLACK_FEEDBACK_WEBHOOK_URL")).toBe("slack");
    expect(providerFromEnvName("DISCORD_ALERTS_WEBHOOK")).toBe("discord");
  });

  it("leaves the app's own URLs alone", () => {
    expect(providerFromEnvName("VITE_API_URL")).toBeUndefined();
    expect(providerFromEnvName("GITHUB_CALLBACK_URL")).toBeUndefined();
    expect(providerFromEnvName("GOOGLE_REDIRECT_URI")).toBeUndefined();
    expect(providerFromEnvName("BILLING_API_URL")).toBeUndefined();
    expect(providerFromEnvName(undefined)).toBeUndefined();
  });
});

describe("resolveProvider", () => {
  it("never returns a template", () => {
    expect(resolveProvider({ hostKind: "unknown", host: "{hostname}:443" })).toEqual({ provider: "unknown" });
    expect(resolveProvider({ hostKind: "env", host: "127.0.0.1:{env:port}", envName: "port" })).toEqual({ provider: "internal" });
    expect(resolveProvider({ hostKind: "env", host: "{env:REPLIT_CONNECTORS_HOSTNAME}", envName: "REPLIT_CONNECTORS_HOSTNAME" })).toEqual({ provider: "env:REPLIT_CONNECTORS_HOSTNAME" });
    expect(resolveProvider({ hostKind: "unknown", host: "calendar.zoho.{region}" })).toEqual({ provider: "unknown" });
  });

  it("says where the provider came from", () => {
    expect(resolveProvider({ hostKind: "literal", host: "api.stripe.com", sdkProvider: "stripe" })).toEqual({ provider: "stripe", source: "sdk" });
    expect(resolveProvider({ hostKind: "literal", host: "api.gladia.io" })).toEqual({ provider: "gladia", source: "host" });
    expect(resolveProvider({ hostKind: "env", envName: "OPENROUTER_BASE_URL" })).toEqual({ provider: "openrouter", source: "env-name" });
    expect(resolveProvider({ hostKind: "relative" })).toEqual({ provider: "internal" });
    expect(resolveProvider({ hostKind: "literal", host: "api.acme.dev" })).toEqual({ provider: "api.acme.dev" });
  });

  it("recognizes local hosts with or without a port", () => {
    for (const h of ["localhost", "localhost:3000", "localhost:", "localhost:{port}", "127.0.0.1:{env:PORT}", "[::1]:8080", "api.local", "app.localhost"]) expect(isLocalhost(h), h).toBe(true);
    for (const h of ["api.example.com", "localhost.example.com", undefined]) expect(isLocalhost(h), String(h)).toBe(false);
  });
});
