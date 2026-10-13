import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const messages = (role: string, content: object) => ({ type: "array", items: { type: "object", properties: { role: { type: "string", enum: [role] }, content } } });

describe("kotlin: LLM SDKs (OpenAI, Anthropic, Gen AI, Bedrock)", () => {
  it("reads builder parameters as the body, enum constants as models, and client builders", async () => {
    const r = await scanFixture("kotlin/sdk/llm");
    expect(r.calls.every((c) => c.location.language === "kotlin" && c.client === "sdk")).toBe(true);
    expect(at(r, "Assistant.kt", 15)).toMatchObject({
      provider: "anthropic",
      method: "POST",
      pathTemplate: "/v1/messages",
      sdk: { package: "com.anthropic:anthropic-java", version: "2.9.0", chain: "messages.create" },
      body: { properties: { model: { enum: ["claude-sonnet-4-5"] }, max_tokens: { enum: [1024] }, messages: messages("user", { hint: "prompt" }) } },
      model: { values: ["claude-sonnet-4-5"], from: "body" },
    });
    // a builder assembled across several statements
    expect(at(r, "Assistant.kt", 24)).toMatchObject({
      body: { properties: { model: { enum: ["claude-haiku-4-5"] }, max_tokens: { type: "union" }, system: { enum: ["Summarize the text."] } }, required: ["model", "max_tokens", "system", "messages"] },
      model: { values: ["claude-haiku-4-5"] },
    });
    expect(at(r, "Assistant.kt", 27)).toMatchObject({ pathTemplate: "/v1/messages/count_tokens", model: { values: ["claude-opus-4-1"] } });
    expect(at(r, "Assistant.kt", 38)).toMatchObject({ host: "llm-gateway.example.com", pathTemplate: "/v1/models", method: "GET" });
    expect(at(r, "Chat.kt", 14)).toMatchObject({
      provider: "openai",
      pathTemplate: "/v1/chat/completions",
      body: { properties: { model: { enum: ["gpt-4.1-mini"] }, max_completion_tokens: { enum: [300] } } },
      model: { values: ["gpt-4.1-mini"] },
    });
    expect(at(r, "Chat.kt", 23)).toMatchObject({ pathTemplate: "/v1/responses", sdk: { chain: "responses.create" }, model: { values: ["gpt-4o"] } });
    expect(at(r, "Chat.kt", 27)).toMatchObject({ method: "GET", pathTemplate: "/v1/files/{file_id}" });
    // a wrapper's parameter: the value its caller passes (#39), and the call at the caller through the wrapper
    expect(at(r, "Ask.kt", 10)).toMatchObject({ model: { values: ["o3"] } });
    expect(at(r, "Ask.kt", 14)).toMatchObject({ via: "wrapper:Ask.ask", model: { values: ["o3"] } });
    expect(at(r, "Models.kt", 16)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/gemini-2.0-flash:generateContent", model: { values: ["gemini-2.0-flash"], from: "path" } });
    expect(at(r, "Models.kt", 18)).toMatchObject({ pathTemplate: "/v1beta/models/gemini-2.5-pro:generateContent" });
    expect(at(r, "Models.kt", 21)).toMatchObject({ provider: "aws-bedrock", pathTemplate: "/model/{modelId}/converse", model: { values: ["anthropic.claude-3-5-haiku-20241022-v1:0"] } });
    // a lambda that fills the request
    expect(at(r, "Models.kt", 23)).toMatchObject({ model: { values: [], env: "BEDROCK_MODEL" } });
    expect(at(r, "Models.kt", 30)).toMatchObject({ pathTemplate: "/model/{modelId}/invoke", model: { values: ["amazon.titan-text-express-v1"] } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status, s.calls])).toEqual([
      ["com.anthropic:anthropic-java", "ok", 4],
      ["com.google.genai:google-genai", "ok", 2],
      ["com.openai:openai-java", "ok", 6],
      ["software.amazon.awssdk:bedrockruntime", "ok", 3],
    ]);
  });
});

describe("kotlin: Stripe", () => {
  it("reads static resources, retrieved objects, StripeClient services and nested builders", async () => {
    const r = await scanFixture("kotlin/sdk/payments");
    expect(at(r, "Billing.kt", 17)).toMatchObject({ provider: "stripe", method: "POST", pathTemplate: "/v1/customers", bodyEncoding: "form", body: { properties: { email: { type: "string" } } } });
    expect(at(r, "Billing.kt", 21)).toMatchObject({ method: "POST", pathTemplate: "/v1/customers/{customer}", sdk: { chain: "Customer.retrieve.update" }, body: { properties: { name: { type: "string" } } } });
    expect(at(r, "Billing.kt", 31)).toMatchObject({
      pathTemplate: "/v1/payment_intents",
      body: { properties: { amount: { type: "integer" }, currency: { enum: ["eur"] }, metadata: { properties: { source: { enum: ["app"] } } } } },
    });
    // a builder assembled across several statements; `params.equals(null)` sets no field
    expect(at(r, "Billing.kt", 31).body).toMatchObject({ required: ["amount", "currency", "customer", "metadata"] });
    expect(at(r, "Billing.kt", 35)).toMatchObject({
      pathTemplate: "/v1/checkout/sessions",
      body: { properties: { mode: { enum: ["subscription"] }, line_items: { type: "array", items: { properties: { price: { type: "string" }, quantity: { enum: [1] } } } } } },
    });
    expect(at(r, "Billing.kt", 45)).toMatchObject({ pathTemplate: "/v1/payment_intents/{intent}/cancel", sdk: { chain: "paymentIntents.cancel" } });
    expect(at(r, "Billing.kt", 47)).toMatchObject({ method: "GET", pathTemplate: "/v1/customers" });
  });
});

describe("kotlin: cloud SDKs (AWS S3, Firestore, Firebase Admin)", () => {
  it("reads request builders and lambdas, endpoint overrides and Firestore references", async () => {
    const r = await scanFixture("kotlin/sdk/cloud");
    expect(at(r, "Storage.kt", 19)).toMatchObject({ provider: "aws", method: "PUT", pathTemplate: "/{Bucket}/{Key}", bodyEncoding: "raw", body: { properties: { Bucket: { enum: ["report-archive"] }, ContentType: { enum: ["application/pdf"] } } } });
    expect(at(r, "Storage.kt", 22)).toMatchObject({ method: "GET", sdk: { chain: "getObjectAsBytes" }, body: { properties: { Bucket: { enum: ["report-archive"] }, Key: { type: "string" } } } });
    expect(at(r, "Storage.kt", 27)).toMatchObject({ host: "localhost:9000", envName: "S3_ENDPOINT", body: { required: ["Bucket", "Prefix"] } });
    expect(at(r, "Storage.kt", 30)).toMatchObject({ method: "GET", pathTemplate: "/" });
    expect(at(r, "Accounts.kt", 12)).toMatchObject({ provider: "firebase", method: "GET", pathTemplate: "/v1/projects/{projectId}/databases/(default)/documents/profiles/{uid}", sdk: { package: "com.google.cloud:google-cloud-firestore" } });
    expect(at(r, "Accounts.kt", 16)).toMatchObject({ pathTemplate: "/v1/projects/{projectId}/databases/(default)/documents/events", sdk: { package: "com.google.firebase:firebase-admin" } });
    expect(at(r, "Accounts.kt", 18)).toMatchObject({ host: "identitytoolkit.googleapis.com", pathTemplate: "/v1/projects/{projectId}/accounts:lookup" });
    expect(at(r, "Accounts.kt", 26)).toMatchObject({ host: "fcm.googleapis.com", body: { properties: { token: { type: "string" }, notification: { properties: { title: { type: "string" } } }, data: { properties: { kind: { enum: ["report"] } } } } } });
    // the admin SDK's `com.google.firebase.auth` imports are not the undeclared Android artifacts'
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["com.google.cloud:google-cloud-firestore", "ok"],
      ["com.google.firebase:firebase-admin", "ok"],
      ["software.amazon.awssdk:s3", "ok"],
    ]);
  });
});

describe("kotlin: messaging and monitoring SDKs (Twilio, Slack, Sentry, PostHog)", () => {
  it("reads resource creators, Slack methods with builders and lambdas, static capture calls", async () => {
    const r = await scanFixture("kotlin/sdk/messaging");
    expect(at(r, "Notifier.kt", 23)).toMatchObject({ provider: "twilio", method: "POST", pathTemplate: "/2010-04-01/Accounts/{AccountSid}/Messages.json", sdk: { chain: "Message.creator.create" } });
    expect(at(r, "Notifier.kt", 25)).toMatchObject({ provider: "sentry", method: "POST" });
    expect(at(r, "Notifier.kt", 29)).toMatchObject({ host: "verify.twilio.com", pathTemplate: "/v2/Services/{ServiceSid}/Verifications" });
    expect(at(r, "Notifier.kt", 32)).toMatchObject({ provider: "slack", pathTemplate: "/api/chat.postMessage", body: { properties: { channel: { type: "string" }, text: { type: "string" } } } });
    expect(at(r, "Notifier.kt", 33)).toMatchObject({ provider: "posthog", host: "eu.i.posthog.com", pathTemplate: "/batch" });
    expect(at(r, "Notifier.kt", 36)).toMatchObject({ body: { properties: { thread_ts: { type: "string" }, text: { enum: ["On it"] } } } });
    expect(at(r, "Notifier.kt", 39)).toMatchObject({ provider: "slack", pathTemplate: "/api/team.info", sdk: { chain: "teamInfo" } });
  });
});

describe("kotlin: SDK coverage", () => {
  it("names a declared and imported JVM SDK whose calls were not found", async () => {
    // Push.kt: the Android firebase-messaging is declared, so its FirebaseMessaging is not firebase-admin's
    const r = await scanFixture("kotlin/negatives");
    expect(r.calls).toEqual([]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.declared, s.supported, s.status])).toEqual([
      ["com.google.firebase:firebase-messaging", "maven", true, false, "unsupported"],
      ["com.stripe:stripe-java", "maven", true, true, "imported-no-calls"],
      ["software.amazon.awssdk:s3", "maven", true, true, "imported-no-calls"],
    ]);
  });

  it("does not count Android Firebase imports for firebase-admin (#62)", async () => {
    // FirebaseApp, analytics, crashlytics, remoteconfig, perf: Android artifacts that are not SDKs of providers.json
    const app = await scanFixture("kotlin/firebase-android");
    expect(app.coverage?.sdks).toEqual([]);
    // declared, firebase-admin's own classes at the root of com.google.firebase still count
    const server = await scanFixture("java/firebase-admin");
    expect(server.coverage?.sdks.map((s) => [s.package, s.declared, s.importSites, s.status])).toEqual([["com.google.firebase:firebase-admin", true, 1, "imported-no-calls"]]);
  });
});
