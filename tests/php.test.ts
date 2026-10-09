import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("php: Guzzle, Laravel Http, Symfony HttpClient", () => {
  it("reads client objects, facades, fluent modifiers and option arrays", async () => {
    const guzzle = await scanFixture("php/guzzle");
    expect(guzzle).toMatchSnapshot();
    expect(guzzle.calls.every((c) => c.location.language === "php" && c.client === "guzzle")).toBe(true);
    expect(at(guzzle, "GitHub.php", 22)).toMatchObject({ provider: "github", hostKind: "literal", pathTemplate: "/repos/{owner}/{repo}/issues", query: ["state", "per_page"], authScheme: "bearer" });
    expect(at(guzzle, "GitHub.php", 27)).toMatchObject({ method: "POST", bodyEncoding: "json" });
    expect(at(guzzle, "GitHub.php", 32)).toMatchObject({ method: "DYNAMIC", pathTemplate: "/{path}" });
    expect(at(guzzle, "GitHub.php", 38)).toMatchObject({ provider: "twilio", bodyEncoding: "form", authScheme: "basic" });
    expect(at(guzzle, "GitHub.php", 47)).toMatchObject({ provider: "cloudinary", bodyEncoding: "multipart" });
    expect(at(guzzle, "GitHub.php", 52)).toMatchObject({ provider: "notion", headerValues: { "notion-version": "2022-06-28" } });
    const laravel = await scanFixture("php/laravel");
    expect(laravel).toMatchSnapshot();
    expect(at(laravel, "Notifier.php", 11)).toMatchObject({ client: "laravel-http", provider: "mailgun", hostKind: "env", envName: "MAILGUN_ENDPOINT", bodyEncoding: "form", authScheme: "basic" });
    expect(at(laravel, "Notifier.php", 18)).toMatchObject({ provider: "slack", bodyEncoding: "json", authScheme: "bearer" });
    expect(at(laravel, "Notifier.php", 26)).toMatchObject({ provider: "hubspot", pathTemplate: "/crm/v3/objects/contacts/{id}", query: ["properties"] });
    expect(laravel.calls.some((c) => c.location.line >= 37)).toBe(false);
    const symfony = await scanFixture("php/symfony");
    expect(symfony).toMatchSnapshot();
    expect(at(symfony, "Weather.php", 16)).toMatchObject({ client: "symfony-http", provider: "open-meteo", query: ["latitude", "longitude"] });
    expect(at(symfony, "Weather.php", 21)).toMatchObject({ provider: "segment", authScheme: "basic", bodyEncoding: "json" });
    expect(at(symfony, "Weather.php", 28)).toMatchObject({ provider: "vercel", pathTemplate: "/v9/projects", authScheme: "bearer" });
    expect(at(symfony, "Weather.php", 34)).toMatchObject({ provider: "linear", method: "POST", authScheme: "bearer" });
  });
});

describe("php: curl, streams, PSR-18, WordPress", () => {
  it("reads curl options, stream contexts, PSR-7 requests and wp_remote_* arguments", async () => {
    const curl = await scanFixture("php/curl");
    expect(curl).toMatchSnapshot();
    expect(at(curl, "legacy.php", 12)).toMatchObject({ client: "curl", provider: "pagerduty", method: "POST", bodyEncoding: "json", headers: ["content-type"] });
    expect(at(curl, "legacy.php", 26)).toMatchObject({ provider: "mailgun", bodyEncoding: "form", authScheme: "basic" });
    expect(at(curl, "legacy.php", 34)).toMatchObject({ method: "DELETE", pathTemplate: "/v0/app123/Tasks/{id}", authScheme: "bearer" });
    expect(at(curl, "legacy.php", 41)).toMatchObject({ bodyEncoding: "multipart" });
    const streams = await scanFixture("php/streams");
    expect(streams.calls.map((c) => [c.location.line, c.client, c.provider, c.method])).toEqual([
      [5, "php-stream", "github", "GET"],
      [17, "php-stream", "mixpanel", "POST"],
    ]);
    expect(at(streams, "fetch.php", 17)).toMatchObject({ headers: ["content-type", "authorization"], authScheme: "bearer", bodyEncoding: "json" });
    const psr = await scanFixture("php/psr");
    expect(psr.calls.map((c) => [c.location.line, c.client, c.method, c.pathTemplate, c.bodyEncoding])).toEqual([
      [22, "psr-18", "POST", "/", "json"],
      [28, "guzzle", "GET", "/api/v2/status.json", "none"],
    ]);
    expect(at(psr, "Webhooks.php", 22)).toMatchObject({ headers: ["content-type"], hostKind: "unknown" });
    const wp = await scanFixture("php/wordpress");
    expect(wp.calls.map((c) => [c.location.line, c.client, c.method, c.bodyEncoding])).toEqual([
      [5, "wordpress", "POST", "form"],
      [13, "wordpress", "GET", "none"],
      [18, "wordpress", "DELETE", "none"],
    ]);
  });
});

describe("php: constants", () => {
  it("follows define(), namespaced and class constants, static properties, sprintf, .= and heredocs", async () => {
    const r = await scanFixture("php/constants", { exclude: [] });
    expect(r).toMatchSnapshot();
    expect(at(r, "Pages.php", 20)).toMatchObject({ provider: "notion", hostKind: "const", pathTemplate: "/v1/pages/{pageId}" });
    expect(at(r, "Pages.php", 25)).toMatchObject({ provider: "linear", pathTemplate: "/graphql" });
    expect(at(r, "Pages.php", 30)).toMatchObject({ provider: "vercel", pathTemplate: "/v9/projects" });
    expect(at(r, "Pages.php", 35)).toMatchObject({ provider: "cal", pathTemplate: "/v1/bookings/{uid}", query: ["apiKey"] });
    expect(at(r, "Pages.php", 42)).toMatchObject({ provider: "unsplash", pathTemplate: "/search/photos" });
    expect(at(r, "Pages.php", 50)).toMatchObject({ provider: "cal", pathTemplate: "/v1/teams/{id}/users" });
    expect(at(r, "Pages.php", 55)).toMatchObject({ provider: "segment", hostKind: "env", envName: "ANALYTICS_HOST" });
  });
});

describe("php: SDKs", () => {
  it("reads instances, factories, facades, static APIs and named arguments", async () => {
    const r = await scanFixture("php/sdk");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "sdk")).toBe(true);
    expect(at(r, "Billing.php", 18)).toMatchObject({ provider: "stripe", pathTemplate: "/v1/customers", bodyEncoding: "form", sdk: { package: "stripe/stripe-php", chain: "customers.create" } });
    expect(at(r, "Billing.php", 23)).toMatchObject({ method: "GET", pathTemplate: "/v1/checkout/sessions", sdk: { chain: "checkout.sessions.all" } });
    expect(at(r, "Billing.php", 28)).toMatchObject({ sdk: { chain: "Customer.create" } });
    expect(at(r, "Billing.php", 33)).toMatchObject({ pathTemplate: "/v1/checkout/sessions", sdk: { chain: "Checkout.Session.create" } });
    expect(r.calls.filter((c) => c.location.line === 38).map((c) => c.sdk?.chain)).toEqual(["PaymentIntent.retrieve", "PaymentIntent.retrieve.confirm"]);
    expect(at(r, "Ai.php", 13)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions" });
    expect(at(r, "Ai.php", 19)).toMatchObject({ provider: "openrouter", host: "openrouter.ai", pathTemplate: "/api/v1/chat/completions" });
    expect(at(r, "Ai.php", 24)).toMatchObject({ provider: "openai", pathTemplate: "/v1/embeddings" });
    expect(Object.keys((at(r, "Ai.php", 30).body as { properties: object }).properties)).toEqual(["maxTokens", "messages", "model"]);
    expect(at(r, "Ai.php", 35)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/gemini-2.0-flash:generateContent" });
    expect(at(r, "Cloud.php", 13)).toMatchObject({ provider: "aws", method: "PUT", pathTemplate: "/{Bucket}/{Key}" });
    expect(at(r, "Cloud.php", 19)).toMatchObject({ provider: "aws-bedrock", pathTemplate: "/model/{modelId}/invoke" });
    expect(at(r, "Cloud.php", 31)).toMatchObject({ host: "verify.twilio.com", pathTemplate: "/v2/Services/{ServiceSid}/Verifications" });
    expect(at(r, "Cloud.php", 42)).toMatchObject({ provider: "mailgun", pathTemplate: "/v3/{domain}/messages" });
    expect(at(r, "Cloud.php", 54)).toMatchObject({ provider: "sendgrid", pathTemplate: "/v3/mail/send" });
    expect(r.calls.some((c) => c.location.file === "Cloud.php" && c.location.line === 47)).toBe(false);
  });

  it("reads Firestore references and typed Firebase services, and leaves out calls that send nothing", async () => {
    const r = await scanFixture("php/sdk/firebase");
    expect(at(r, "Users.php", 20)).toMatchObject({ host: "identitytoolkit.googleapis.com", sdk: { chain: "createUser" } });
    expect(at(r, "Users.php", 25)).toMatchObject({ method: "PATCH", pathTemplate: "/v1/projects/{projectId}/databases/(default)/documents/users/{uid}" });
    expect(r.calls.some((c) => c.location.line === 41)).toBe(false);
    const sentry = await scanFixture("php/sdk/sentry");
    // `track()` -> `report($e)` sends the same request as the capture inside `report`: not a call of its own
    expect(sentry.calls.map((c) => [c.location.line, c.sdk?.chain, c.via ?? null])).toEqual([
      [9, "captureException", null],
      [14, "captureMessage", null],
    ]);
  });
});

describe("php: wrappers, diagnostics and coverage", () => {
  it("expands methods and functions at their call sites", async () => {
    const r = await scanFixture("php/wrappers/basic");
    expect(at(r, "Intercom.php", 18)).toMatchObject({ via: "wrapper:Intercom.request", method: "GET", pathTemplate: "/contacts" });
    expect(at(r, "Intercom.php", 23)).toMatchObject({ via: "wrapper:Intercom.request", method: "POST", pathTemplate: "/contacts/{contactId}/tags" });
    const injected = await scanFixture("php/wrappers/injected-client");
    expect(injected.diagnostics?.unfollowed).toEqual([
      { file: "Provider.php", line: 16, reason: "injected-client", expr: "this.client.post" },
      { file: "Provider.php", line: 21, reason: "injected-fetch", expr: "deps.fetchUpstream" },
    ]);
  });

  it("skips a file that does not parse and leaves tests out of scope", async () => {
    const r = await scanFixture("php/diagnostics", { exclude: [] });
    expect(r.diagnostics).toMatchObject({
      filesSeen: 2,
      filesScanned: 1,
      skipped: [{ file: "broken.php", reason: "parse-error", detail: "syntax error at line 3" }],
      languages: { php: { filesSeen: 2, filesScanned: 1 } },
      complete: false,
    });
  });

  it("compares the Composer packages declared and imported with the calls found", async () => {
    const r = await scanFixture("php/coverage");
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status, s.importSites, s.calls])).toEqual([
      ["knplabs/github-api", "composer", "unsupported", 1, 0],
      ["sendgrid/sendgrid", "composer", "declared-not-imported", 0, 0],
      ["sentry/sentry", "composer", "imported-no-calls", 1, 0],
      ["sentry/sentry-laravel", "composer", "imported-no-calls", 1, 0],
      ["stripe/stripe-php", "composer", "ok", 1, 1],
    ]);
    expect(at(r, "Billing.php", 7).sdk).toMatchObject({ package: "stripe/stripe-php", version: "^13.0" });
  });
});
