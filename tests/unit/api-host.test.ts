import { describe, expect, it } from "vitest";
import { hostCoverage, MAX_UNEXPLAINED } from "../../src/hosts/coverage.js";
import { isApiHost, registrableDomain } from "../../src/hosts/api-host.js";
import { HostLiterals, hostsInLiteral, normalizeHost } from "../../src/hosts/literals.js";
import type { Call } from "../../src/report/schema.js";

const hosts = (literal: string): string[] => hostsInLiteral(literal).map((m) => m.host);

describe("isApiHost", () => {
  it.each([
    ["api.openai.com", ""],
    ["api-inference.huggingface.co", "/models/x"],
    ["chat-api.acme.io", ""],
    ["acme.supabase.co", ""],
    ["generativelanguage.googleapis.com", "/v1beta/models"],
    ["hooks.slack.com", "/services/x"],
    ["openrouter.ai", "/api/v1"],
    ["acme.com", "/v2/orders"],
    ["acme.com", "/v2beta/orders"],
    ["www.acme.com", "/graphql"],
    ["billing.acme.com", "/rest/items"],
    ["tg.acme.com", "/bot${}/sendMessage"],
    ["github.com", "/login/oauth/access_token"],
    ["huggingface.co", "/api/models"],
    ["gateway.ai.cloudflare.com", ""],
    ["acme.openai.azure.com", ""],
    ["registry.npmjs.org", "/react"],
  ])("counts %s%s", (host, path) => expect(isApiHost(host, path)).toBe(true));

  it("finds the registrable domain under a two-label suffix", () => {
    expect(registrableDomain("api.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("api.acme.com")).toBe("acme.com");
  });
});

describe("isApiHost: noise", () => {
  it.each([
    ["localhost", "/v1"],
    ["backend", "/api/x"],
    ["api.internal", "/v1"],
    ["svc.cluster.local", "/v1"],
    ["10.0.0.4", "/v1"],
    ["example.com", "/v1/users"],
    ["api.example.org", "/v1"],
    ["your-domain.com", "/api"],
    ["docs.stripe.com", "/api"],
    ["api-docs.deepseek.com", ""],
    ["platform.openai.com", "/account/api-keys"],
    ["www.acme.com", "/pricing"],
    ["acme.com", ""],
    ["github.com", "/acme/api/blob/main/README.md"],
    ["huggingface.co", "/meta-llama/Llama-3-8B"],
    ["raw.githubusercontent.com", "/acme/repo/main/v1/x"],
    ["json-schema.org", "/draft/2020-12/schema"],
    ["www.w3.org", "/2000/svg"],
    ["img.shields.io", "/badge/x"],
    ["en.wikipedia.org", "/wiki/API"],
    ["pypi.org", "/project/openai"],
    ["fonts.googleapis.com", "/css2"],
    ["cdn.acme.com", "/v1/app.js"],
    ["api.acme.com", "/v1/logo.png?size=2"],
  ])("leaves out %s%s", (host, path) => expect(isApiHost(host, path)).toBe(false));
});

describe("hostsInLiteral", () => {
  it("reads every URL of a literal, user info and port aside", () => {
    expect(hosts("POST https://key@API.Acme.com:8443/v1/x then https://api.other.io/v2")).toEqual(["api.acme.com", "api.other.io"]);
    expect(hostsInLiteral("intro\nsee https://api.acme.com/v1")).toEqual([{ host: "api.acme.com", lineOffset: 1 }]);
  });

  it("leaves out hosts split by a placeholder", () => {
    expect(hosts("https://${region}.api.acme.com/v1")).toEqual([]);
    expect(hosts("https://api.${}/v1")).toEqual([]);
    expect(hosts("https://%s/v1")).toEqual([]);
  });

  it("reads a literal that is only a host when it names a provider or an api host", () => {
    expect(hosts("api.openai.com")).toEqual(["api.openai.com"]);
    expect(hosts("api.acme.io")).toEqual(["api.acme.io"]);
    expect(hosts("gateway.ai.cloudflare.com")).toEqual(["gateway.ai.cloudflare.com"]);
    // module paths and file names look like hosts
    expect(hosts("api.client.py")).toEqual([]);
    expect(hosts("api.v1.endpoints")).toEqual([]);
    expect(hosts("billing.acme.com")).toEqual([]);
  });

  it("normalizes hosts", () => {
    expect(normalizeHost("API.Acme.com.:443")).toBe("api.acme.com");
    expect(normalizeHost("{project}.supabase.co")).toBeUndefined();
  });
});

const call = (host: string | undefined): Call => ({ host }) as Call;

describe("hostCoverage", () => {
  it("explains hosts by the calls' hosts, templates included", () => {
    const lit = new HostLiterals();
    lit.add("https://acme.supabase.co", "b.ts", 3, "typescript");
    lit.add("https://API.openai.com/v1", "a.py", 9, "python");
    lit.add("https://api.telegram.org", "z.ts", 1, "typescript");
    lit.add("https://api.telegram.org/bot", "a.ts", 7, "typescript");
    lit.add("https://api.mailgun.net/v3", "c.go", 2, "go");
    const r = hostCoverage(lit, [call("api.openai.com:443"), call("{project}.supabase.co"), call("{baseUrl}"), call(undefined)]);
    expect(r.named).toBe(4);
    expect(r.explained).toBe(2);
    expect(r.byLanguage).toEqual([
      { language: "typescript", named: 2, explained: 1 },
      { language: "go", named: 1, explained: 0 },
      { language: "python", named: 1, explained: 1 },
    ]);
    expect(r.unexplained).toEqual([
      { host: "api.telegram.org", files: 2, literals: 2, language: "typescript", first: { file: "a.ts", line: 7 } },
      { host: "api.mailgun.net", files: 1, literals: 1, language: "go", first: { file: "c.go", line: 2 } },
    ]);
  });

  it("lists at most 200 unexplained hosts and counts them all", () => {
    const lit = new HostLiterals();
    for (let i = 0; i < MAX_UNEXPLAINED + 5; i++) lit.add(`https://api.host${i}.com`, "a.ts", 1, "typescript");
    const r = hostCoverage(lit, []);
    expect(r.named).toBe(MAX_UNEXPLAINED + 5);
    expect(r.unexplained).toHaveLength(MAX_UNEXPLAINED);
  });
});
