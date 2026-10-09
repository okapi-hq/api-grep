import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("python: requests", () => {
  it("matches snapshot and key expectations", async () => {
    const r = await scanFixture("python/requests");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "python" && c.client === "requests")).toBe(true);
    expect(at(r, "verbs.py", 10)).toMatchObject({ provider: "stripe", method: "POST", pathTemplate: "/v1/customers", bodyEncoding: "form", authScheme: "bearer", headers: ["authorization"] });
    expect(at(r, "verbs.py", 18)).toMatchObject({ provider: "github", pathTemplate: "/repos/{owner}/{repo}/issues", query: ["state", "per_page"] });
    expect(at(r, "verbs.py", 22)).toMatchObject({ method: "DELETE", pathTemplate: "/v1/blocks/{page_id}", headerValues: { "notion-version": "2022-06-28" } });
    expect(at(r, "verbs.py", 27)).toMatchObject({ provider: "cloudinary", bodyEncoding: "multipart", authScheme: "basic" });
    expect(at(r, "verbs.py", 31)).toMatchObject({ method: "DYNAMIC", provider: "linear" });
    expect(at(r, "session.py", 10)).toMatchObject({ provider: "hubspot", pathTemplate: "/crm/v3/objects/contacts/{contact_id}", authScheme: "bearer" });
    expect(at(r, "session.py", 15)).toMatchObject({ provider: "twilio", bodyEncoding: "form", authScheme: "basic" });
  });
});

describe("python: httpx, aiohttp, urllib", () => {
  it("reads client objects, base URLs and request objects", async () => {
    const httpx = await scanFixture("python/httpx");
    expect(httpx).toMatchSnapshot();
    expect(at(httpx, "client.py", 8)).toMatchObject({ client: "httpx", provider: "vercel", hostKind: "const", pathTemplate: "/v6/deployments", query: ["teamId", "limit"], authScheme: "bearer" });
    expect(at(httpx, "client.py", 13)).toMatchObject({ provider: "slack", bodyEncoding: "json" });
    expect(at(httpx, "client.py", 17)).toMatchObject({ method: "PUT", bodyEncoding: "raw" });
    expect(at(httpx, "client.py", 21)).toMatchObject({ method: "GET", pathTemplate: "/v1/jobs/{job}/logs" });
    const aiohttp = await scanFixture("python/aiohttp");
    expect(aiohttp).toMatchSnapshot();
    expect(at(aiohttp, "session.py", 6)).toMatchObject({ client: "aiohttp", provider: "sendgrid", method: "POST" });
    expect(at(aiohttp, "session.py", 12)).toMatchObject({ provider: "open-meteo", pathTemplate: "/v1/forecast", query: ["latitude", "longitude"] });
    const urllib = await scanFixture("python/urllib");
    expect(urllib).toMatchSnapshot();
    expect(at(urllib, "request.py", 7)).toMatchObject({ client: "urllib", method: "GET", provider: "github" });
    expect(at(urllib, "request.py", 12)).toMatchObject({ method: "POST", provider: "segment", bodyEncoding: "json", headers: ["content-type"] });
    expect(at(urllib, "request.py", 16)).toMatchObject({ method: "POST", bodyEncoding: "form" });
    expect(at(urllib, "request.py", 20)).toMatchObject({ method: "DELETE", pathTemplate: "/v3/lists/{list_id}" });
    expect(at(urllib, "pool.py", 11)).toMatchObject({ client: "urllib3", provider: "pagerduty", method: "POST" });
  });
});

describe("python: constants", () => {
  it("follows module constants, imported modules, class constants and string formatting", async () => {
    const r = await scanFixture("python/constants");
    expect(r).toMatchSnapshot();
    expect(at(r, "use_config.py", 8)).toMatchObject({ provider: "notion", hostKind: "const", pathTemplate: "/v1/pages/{page_id}" });
    expect(at(r, "use_config.py", 12)).toMatchObject({ provider: "linear", pathTemplate: "/graphql" });
    expect(at(r, "use_config.py", 16)).toMatchObject({ provider: "vercel", pathTemplate: "/v9/projects" });
    expect(at(r, "use_config.py", 20)).toMatchObject({ provider: "notion", pathTemplate: "/v1/databases/{db_id}/query" });
    expect(at(r, "formats.py", 10)).toMatchObject({ provider: "cal", pathTemplate: "/v1/bookings/{uid}", query: ["apiKey"] });
    expect(at(r, "formats.py", 14)).toMatchObject({ pathTemplate: "/v1/bookings/{uid}" });
    expect(at(r, "formats.py", 18)).toMatchObject({ pathTemplate: "/v1/teams/{team_id}/users" });
    expect(at(r, "formats.py", 22)).toMatchObject({ pathTemplate: "/v2/me" });
    expect(at(r, "formats.py", 28)).toMatchObject({ pathTemplate: "/v1/schedules" });
    expect(at(r, "formats.py", 32)).toMatchObject({ provider: "segment", hostKind: "env", envName: "ANALYTICS_HOST" });
  });
});

describe("python: SDKs", () => {
  it("reads clients, module-level APIs and keyword-argument bodies", async () => {
    const r = await scanFixture("python/sdk");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "sdk")).toBe(true);
    expect(at(r, "llm.py", 16)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions", sdk: { package: "openai", chain: "chat.completions.create" } });
    expect(Object.keys((at(r, "llm.py", 16).body as { properties: object }).properties)).toEqual(["model", "messages", "temperature"]);
    expect(at(r, "llm.py", 20)).toMatchObject({ provider: "openai", pathTemplate: "/v1/embeddings" });
    expect(at(r, "llm.py", 24)).toMatchObject({ provider: "openrouter", host: "openrouter.ai", pathTemplate: "/api/v1/chat/completions" });
    expect(at(r, "llm.py", 28)).toMatchObject({ method: "GET", pathTemplate: "/v1/files/{file_id}" });
    expect(at(r, "llm.py", 32)).toMatchObject({ provider: "anthropic", pathTemplate: "/v1/messages", authScheme: "apikey" });
    expect(at(r, "llm.py", 40)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/gemini-2.0-flash:generateContent" });
    expect(at(r, "llm.py", 48)).toMatchObject({ provider: "openai", pathTemplate: "/v1/responses" });
    expect(at(r, "stripe_billing.py", 9)).toMatchObject({ provider: "stripe", pathTemplate: "/v1/customers", bodyEncoding: "form", sdk: { chain: "Customer.create" } });
    expect(at(r, "stripe_billing.py", 17)).toMatchObject({ pathTemplate: "/v1/checkout/sessions" });
    expect(at(r, "stripe_billing.py", 21)).toMatchObject({ pathTemplate: "/v1/customers", sdk: { chain: "customers.create" } });
    expect(at(r, "stripe_billing.py", 25)).toMatchObject({ method: "DELETE", sdk: { chain: "v1.subscriptions.cancel" } });
    expect(at(r, "cloud.py", 21)).toMatchObject({ provider: "aws", method: "PUT", pathTemplate: "/{Bucket}/{Key}", bodyEncoding: "raw" });
    expect(at(r, "cloud.py", 25)).toMatchObject({ provider: "aws-bedrock", pathTemplate: "/model/{modelId}/invoke" });
    expect(r.calls.some((c) => c.location.file === "cloud.py" && c.location.line === 29)).toBe(false);
    expect(at(r, "cloud.py", 37)).toMatchObject({ host: "verify.twilio.com", pathTemplate: "/v2/Services/{ServiceSid}/Verifications" });
    expect(at(r, "cloud.py", 45)).toMatchObject({ provider: "slack", host: "hooks.slack.com", pathTemplate: "/services/T000/B000/XXXX" });
    expect(at(r, "cloud.py", 54)).toMatchObject({ provider: "posthog", host: "eu.i.posthog.com" });
  });

  it("reports one Supabase request per builder chain, also through typed parameters", async () => {
    const r = await scanFixture("python/sdk/supabase");
    expect(at(r, "db.py", 9)).toMatchObject({ method: "GET", pathTemplate: "/rest/v1/tasks", hostKind: "env", envName: "SUPABASE_URL" });
    expect(r.calls.filter((c) => c.location.line === 17).map((c) => c.pathTemplate)).toEqual(["/rest/v1/profiles", "/rest/v1/audit"]);
    expect(at(r, "db.py", 21)).toMatchObject({ pathTemplate: "/rest/v1/rpc/daily_stats" });
    expect(at(r, "db.py", 37)).toMatchObject({ pathTemplate: "/functions/v1/send-welcome" });
    expect(at(r, "db.py", 42)).toMatchObject({ method: "DELETE", pathTemplate: "/rest/v1/tasks" });
  });

  it("reads Firestore references and leaves out calls that send nothing", async () => {
    const r = await scanFixture("python/sdk/firebase");
    expect(at(r, "store.py", 13)).toMatchObject({ method: "PATCH", pathTemplate: "/v1/projects/{projectId}/databases/(default)/documents/users/{uid}" });
    expect(at(r, "store.py", 17)).toMatchObject({ method: "POST", pathTemplate: "/v1/projects/{projectId}/databases/(default)/documents/users/{uid}/posts" });
    expect(at(r, "store.py", 21)).toMatchObject({ host: "identitytoolkit.googleapis.com" });
    expect(r.calls.some((c) => c.location.line === 29)).toBe(false);
    const sentry = await scanFixture("python/sdk/sentry");
    // `track(err)` -> `report(err)` sends the same request as the capture inside `report`: not a call of its own
    expect(sentry.calls.map((c) => c.location.line)).toEqual([8, 12]);
  });
});

describe("python: wrappers", () => {
  it("expands project functions and methods at their call sites", async () => {
    const r = await scanFixture("python/wrappers/basic");
    expect(r).toMatchSnapshot();
    expect(at(r, "client.py", 18)).toMatchObject({ via: "wrapper:Airtable._post", pathTemplate: "/v0/{base_id}/Tasks" });
    expect(at(r, "client.py", 22)).toMatchObject({ via: "wrapper:intercom", method: "GET", pathTemplate: "/contacts", bodyEncoding: "none" });
    expect(at(r, "client.py", 26)).toMatchObject({ via: "wrapper:intercom", method: "POST", pathTemplate: "/contacts/{contact_id}/tags" });
  });
});

describe("python: diagnostics and coverage", () => {
  it("skips a file that does not parse and leaves tests out of scope", async () => {
    const r = await scanFixture("python/diagnostics", { exclude: [] });
    expect(r.diagnostics).toMatchObject({
      filesSeen: 2,
      filesScanned: 1,
      skipped: [{ file: "broken.py", reason: "parse-error", detail: "syntax error at line 4" }],
      languages: { python: { filesSeen: 2, filesScanned: 1 } },
      complete: false,
    });
    expect(r.calls.map((c) => c.location.file)).toEqual(["ok.py"]);
  });

  it("lists injected clients as calls not followed", async () => {
    const r = await scanFixture("python/wrappers/injected-client");
    expect(r.diagnostics?.unfollowed).toEqual([
      { file: "provider.py", line: 10, reason: "injected-client", expr: "this.session.post" },
      { file: "provider.py", line: 17, reason: "injected-fetch", expr: "deps.fetch_upstream" },
    ]);
    expect(at(r, "provider.py", 13)).toMatchObject({ client: "requests", provider: "mistral" });
  });

  it("compares the PyPI SDKs declared and imported with the calls found", async () => {
    const r = await scanFixture("python/coverage");
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status, s.importSites, s.calls])).toEqual([
      ["notion-client", "pypi", "unsupported", 1, 0],
      ["sentry-sdk", "pypi", "imported-no-calls", 1, 0],
      ["stripe", "pypi", "ok", 1, 1],
      ["supabase", "pypi", "declared-not-imported", 0, 0],
    ]);
    expect(at(r, "billing.py", 5).sdk).toMatchObject({ package: "stripe", version: "9.1.0" });
  });
});

describe("several languages in one repository", () => {
  it("scans each language and says where every call comes from", async () => {
    const r = await scanFixture("polyglot", { exclude: [] });
    expect(r.calls.map((c) => [c.location.file, c.location.language, c.provider, c.sdk?.version])).toEqual([
      ["api/chat.py", "python", "openai", ">=1.40"],
      ["web/chat.ts", "typescript", "openai", "^4.0.0"],
    ]);
    expect(r.stats.byLanguage).toEqual({ python: 1, typescript: 1 });
    expect(r.diagnostics?.languages).toEqual({ typescript: { filesSeen: 1, filesScanned: 1 }, python: { filesSeen: 1, filesScanned: 1 } });
    expect(r.coverage?.sdks.map((s) => `${s.ecosystem}:${s.package}:${s.status}`)).toEqual(["npm:openai:ok", "pypi:openai:ok"]);
    const onlyPython = await scanFixture("polyglot", { exclude: [], languages: ["python"] });
    expect(onlyPython.calls.map((c) => c.location.language)).toEqual(["python"]);
  });
});
