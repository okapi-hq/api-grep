import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toJson } from "../src/report/json.js";
import { scan } from "../src/scan.js";
import type { Call, Report } from "../src/report/schema.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function scanFixture(name: string): Promise<Report> {
  const report = await scan({ dir: path.join(FIXTURES, name) });
  const json = JSON.parse(toJson(report)) as Report;
  json.stats.durationMs = 0;
  delete json.commit;
  return json;
}

const at = (r: Report, file: string, line: number): Call => {
  const c = r.calls.find((x) => x.location.file === file && x.location.line === line);
  if (!c) throw new Error(`no call at ${file}:${line}; have ${r.calls.map((x) => `${x.location.file}:${x.location.line}`).join(", ")}`);
  return c;
};

describe("fetch", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("fetch");
    expect(r).toMatchSnapshot();
    expect(at(r, "literal.ts", 4)).toMatchObject({ provider: "stripe", method: "POST", pathTemplate: "/v1/customers", bodyEncoding: "form", authScheme: "bearer", headers: ["authorization", "content-type"] });
    expect(at(r, "template.ts", 3)).toMatchObject({ provider: "github", pathTemplate: "/repos/{owner}/{repo}/issues", query: ["state", "per_page"] });
    expect(at(r, "env.ts", 2)).toMatchObject({ hostKind: "env", envName: "API_URL", host: "api.example.com", method: "PUT", pathTemplate: "/v1/things/{id}" });
    expect(at(r, "typed-body.ts", 10)).toMatchObject({ bodyFromType: "CreateUser" });
    expect(at(r, "typed-body.ts", 14).body).toEqual({ type: "dynamic", origin: "param", hint: "input" });
    expect(at(r, "formdata.ts", 7)).toMatchObject({ bodyEncoding: "multipart", authScheme: "apikey" });
    expect(at(r, "newurl.ts", 6)).toMatchObject({ provider: "unsplash", pathTemplate: "/search/photos", query: ["query"] });
    expect(at(r, "node-fetch.ts", 4)).toMatchObject({ provider: "slack", method: "POST" });
    expect(at(r, "opaque-options.ts", 5).dynamic).toContainEqual({ where: "method", name: "options", origin: "unknown" });
    expect(at(r, "opaque-options.ts", 9).method).toBe("DYNAMIC");
  });
});

describe("axios", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("axios");
    expect(r).toMatchSnapshot();
    expect(at(r, "verbs.ts", 6)).toMatchObject({ provider: "openai", method: "POST", authScheme: "bearer" });
    expect(at(r, "verbs.ts", 9)).toMatchObject({ method: "GET", pathTemplate: "/users/{id}", query: ["per_page"] });
    expect(at(r, "config.ts", 8)).toMatchObject({ provider: "stripe", pathTemplate: "/v1/refunds", method: "POST" });
    expect(at(r, "instance.ts", 7)).toMatchObject({ provider: "linear", pathTemplate: "/graphql", headers: ["authorization"] });
    expect(at(r, "alias.ts", 3)).toMatchObject({ provider: "github", client: "axios" });
    expect(at(r, "consumer.ts", 4)).toMatchObject({ provider: "hubspot", hostKind: "env", pathTemplate: "/crm/v3/objects/contacts/{id}", authScheme: "bearer" });
    expect(at(r, "require.ts", 4)).toMatchObject({ client: "axios", method: "POST" });
    expect(at(r, "factory-var.ts", 10)).toMatchObject({ provider: "vercel", pathTemplate: "/v6/deployments" });
    expect(at(r, "factory.ts", 9)).toMatchObject({ provider: "linear", pathTemplate: "/teams", authScheme: "bearer" });
    expect(at(r, "aliased-consumer.ts", 3)).toMatchObject({ provider: "hubspot", pathTemplate: "/crm/v3/objects/deals", authScheme: "bearer" });
  });
});

describe("got and ky", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("gotky");
    expect(r).toMatchSnapshot();
    expect(at(r, "got.ts", 4)).toMatchObject({ client: "got", provider: "sendgrid", bodyEncoding: "json" });
    expect(at(r, "got.ts", 17)).toMatchObject({ provider: "mailgun", pathTemplate: "/v3/example.com/messages", bodyEncoding: "form" });
    expect(at(r, "ky.ts", 9)).toMatchObject({ client: "ky", provider: "cal", pathTemplate: "/v1/bookings", query: ["apiKey"] });
  });
});

describe("sdk", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("sdk");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "sdk" && c.confidence === 1)).toBe(true);
    expect(at(r, "stripe-literal.ts", 6)).toMatchObject({ provider: "stripe", pathTemplate: "/v1/customers", operationId: "PostCustomers", bodyEncoding: "form" });
    expect(at(r, "stripe-typed.ts", 9)).toMatchObject({ bodyFromType: "CustomerCreateParams" });
    expect(Object.keys((at(r, "stripe-typed.ts", 9).body as { properties: object }).properties)).toContain("email");
    expect(at(r, "stripe-typed.ts", 13)).toMatchObject({ pathTemplate: "/v1/subscriptions/{subscription_exposed_id}" });
    expect(at(r, "openai.ts", 6)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions" });
    expect(at(r, "octokit.ts", 6)).toMatchObject({ provider: "github", method: "POST", pathTemplate: "/repos/{owner}/{repo}/issues" });
    expect(at(r, "octokit.ts", 9)).toMatchObject({ method: "GET", pathTemplate: "/repos/{owner}/{repo}" });
    expect(at(r, "aws.ts", 6)).toMatchObject({ provider: "aws", method: "PUT", pathTemplate: "/{Bucket}/{Key}", sdk: { chain: "PutObjectCommand" } });
    expect(at(r, "aws.ts", 10)).toMatchObject({ method: "GET" });
    expect(at(r, "slack.ts", 5)).toMatchObject({ provider: "slack", pathTemplate: "/api/chat.postMessage" });
    expect(at(r, "twilio.ts", 7)).toMatchObject({ provider: "twilio", pathTemplate: "/v2/Services/{ServiceSid}/Verifications" });
    expect(at(r, "class-member.ts", 7)).toMatchObject({ pathTemplate: "/v1/payment_intents" });
    expect(at(r, "class-member.ts", 15)).toMatchObject({ pathTemplate: "/v1/balance" });
  });
});

describe("constants", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("constants");
    expect(r).toMatchSnapshot();
    expect(at(r, "same-file.ts", 3)).toMatchObject({ provider: "notion", hostKind: "const", pathTemplate: "/v1/pages/{pageId}" });
    expect(at(r, "use-config.ts", 3)).toMatchObject({ provider: "linear", hostKind: "const", pathTemplate: "/graphql" });
    expect(at(r, "use-config.ts", 4)).toMatchObject({ provider: "vercel", pathTemplate: "/v9/projects" });
    expect(at(r, "env.ts", 4)).toMatchObject({ provider: "segment", hostKind: "env", envName: "ANALYTICS_HOST" });
    expect(at(r, "env.ts", 8)).toMatchObject({ provider: "env:OTHER_HOST", hostKind: "env" });
    expect(at(r, "enum.ts", 5)).toMatchObject({ pathTemplate: "/users", hostKind: "const" });
    expect(at(r, "concat.ts", 1)).toMatchObject({ pathTemplate: "/x/{id}" });
    expect(at(r, "concat.ts", 2)).toMatchObject({ pathTemplate: "/v1/{a}" });
  });
});

describe("negatives", () => {
  it("ignores shadowed fetch, mocks and plain strings; reports relative calls as internal", async () => {
    const r = await scanFixture("negatives");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => c.location.file).sort()).toEqual(["relative.ts", "then-chain.ts"]);
    expect(at(r, "relative.ts", 1)).toMatchObject({ provider: "internal", hostKind: "relative" });
    expect(at(r, "relative.ts", 1).confidence).toBeLessThanOrEqual(0.4);
  });
});

describe("wrappers", () => {
  it("expands one-hop wrappers at the call site", async () => {
    const r = await scanFixture("wrappers");
    expect(r).toMatchSnapshot();
    expect(at(r, "function-wrapper.ts", 7)).toMatchObject({ via: "wrapper:post", provider: "hubspot", method: "POST", pathTemplate: "/crm/v3/objects/contacts", authScheme: "bearer" });
    expect(at(r, "class-wrapper.ts", 13)).toMatchObject({ via: "wrapper:NotionClient.post", provider: "notion", pathTemplate: "/v1/pages" });
    expect(at(r, "destructured.ts", 5)).toMatchObject({ via: "wrapper:request", method: "POST", pathTemplate: "/graphql" });
    expect(at(r, "intermediate.ts", 6)).toMatchObject({ via: "wrapper:proxied", provider: "pagerduty", method: "POST", pathTemplate: "/incidents" });
  });

  it("can be disabled", async () => {
    const r = await scan({ dir: path.join(FIXTURES, "wrappers"), wrappers: false });
    expect(r.calls.some((c) => c.via)).toBe(false);
  });
});

describe("node http", () => {
  it("reads options objects and url-first calls", async () => {
    const r = await scanFixture("nodehttp");
    expect(r).toMatchSnapshot();
    expect(at(r, "https.ts", 4)).toMatchObject({ client: "node-http", provider: "pagerduty", method: "POST", pathTemplate: "/incidents", authScheme: "apikey" });
    expect(at(r, "https.ts", 8)).toMatchObject({ method: "GET", pathTemplate: "/health" });
  });
});
