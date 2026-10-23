import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("kotlin and java: more LLM SDKs (#50)", () => {
  it("reads openai-kotlin data classes and LangChain4j model builders", async () => {
    const r = await scanFixture("kotlin/sdk/ai");
    // named constructor arguments are the body, `ModelId(...)` the model id, `ChatRole.User` its value
    expect(at(r, "Tutor.kt", 17)).toMatchObject({
      provider: "openai",
      pathTemplate: "/v1/chat/completions",
      sdk: { package: "com.aallam.openai:openai-client", version: "4.0.1", chain: "chatCompletion" },
      body: { properties: { model: { enum: ["gpt-4o-mini"] }, max_tokens: { enum: [400] }, messages: { type: "array" } } },
      model: { values: ["gpt-4o-mini"] },
    });
    expect(JSON.stringify(at(r, "Tutor.kt", 17).body)).toContain('"enum":["system"]');
    // the host of `OpenAIConfig(host = OpenAIHost(baseUrl = ...))`
    expect(at(r, "Tutor.kt", 28)).toMatchObject({ host: "llm-gateway.example.com", model: { values: ["text-embedding-3-small"] } });
    expect(at(r, "Tutor.kt", 30)).toMatchObject({ method: "GET", pathTemplate: "/v1/models" });
    // a model client is the call, its request settings the body (client settings left out)
    expect(at(r, "Graders.kt", 11)).toMatchObject({ provider: "openai", sdk: { chain: "build" }, model: { values: ["gpt-4o-mini"] }, body: { required: ["model", "temperature"] } });
    expect(at(r, "Graders.kt", 18)).toMatchObject({ provider: "anthropic", pathTemplate: "/v1/messages", body: { properties: { model: { enum: ["claude-3-5-haiku-20241022"] }, max_tokens: { enum: [512] } } } });
    expect(at(r, "Graders.kt", 24)).toMatchObject({ provider: "ollama", host: "ollama.internal:11434", pathTemplate: "/api/chat", model: { values: ["llama3.1"] } });
    expect(r.calls.some((c) => c.location.file === "Graders.kt" && c.location.line === 26)).toBe(false);
  });

  it("reads Azure OpenAI deployments and LangChain4j Gemini, Mistral and Bedrock models from Java", async () => {
    const r = await scanFixture("java/sdk-ai");
    expect(at(r, "Helpdesk.java", 20)).toMatchObject({
      provider: "azure-openai",
      host: "contoso-support.openai.azure.com",
      pathTemplate: "/openai/deployments/{model}/chat/completions",
      model: { values: ["support-gpt-4o"], from: "argument" },
    });
    expect(at(r, "Triage.java", 10)).toMatchObject({ provider: "google-ai", pathTemplate: "/v1beta/models/{model}:generateContent", model: { values: ["gemini-2.0-flash"] } });
    expect(at(r, "Triage.java", 16)).toMatchObject({ provider: "mistral", model: { values: ["mistral-small-latest"] } });
    expect(at(r, "Triage.java", 21)).toMatchObject({ provider: "aws-bedrock", pathTemplate: "/model/{modelId}/converse", model: { values: ["anthropic.claude-3-5-haiku-20241022-v1:0"] } });
  });
});

describe("kotlin and java: Firebase for Android, supabase-kt and email SDKs (#50)", () => {
  it("reads Auth, Realtime Database, Storage and callable Functions", async () => {
    const r = await scanFixture("kotlin/sdk/firebase-app");
    expect(at(r, "Journal.kt", 15)).toMatchObject({ host: "identitytoolkit.googleapis.com", pathTemplate: "/v1/accounts:signInWithPassword", body: { properties: { email: { type: "string" }, password: { type: "string" } } } });
    expect(at(r, "Journal.kt", 24)).toMatchObject({ method: "PUT", host: "{project}.firebaseio.com", pathTemplate: "/entries/{id}.json", sdk: { package: "com.google.firebase:firebase-database" } });
    expect(at(r, "Journal.kt", 26)).toMatchObject({ method: "POST", pathTemplate: "/entries.json" });
    expect(at(r, "Journal.kt", 30)).toMatchObject({ host: "firebasestorage.googleapis.com", urlTemplate: "https://firebasestorage.googleapis.com/v0/b/{bucket}/o?name=photos/{id}.jpg" });
    expect(at(r, "Journal.kt", 32)).toMatchObject({ host: "{region}-{projectId}.cloudfunctions.net", pathTemplate: "/summarizeEntry", body: { properties: { id: { type: "string" } } } });
    // signing out sends nothing
    expect(r.calls.some((c) => c.location.line === 22)).toBe(false);
    expect(at(r, "Photos.java", 12)).toMatchObject({ method: "GET", pathTemplate: "/v0/b/{bucket}/o/photos/{name}" });
    expect(at(r, "Photos.java", 21)).toMatchObject({ host: "securetoken.googleapis.com" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status, s.calls])).toEqual([
      ["com.google.firebase:firebase-auth", "ok", 5],
      ["com.google.firebase:firebase-database", "ok", 3],
      ["com.google.firebase:firebase-functions", "ok", 1],
      ["com.google.firebase:firebase-storage", "ok", 2],
    ]);
  });

  it("reads supabase-kt modules on a created or an injected client", async () => {
    const r = await scanFixture("kotlin/sdk/supabase");
    expect(at(r, "Recipes.kt", 24)).toMatchObject({ method: "GET", host: "recipes-demo.supabase.co", pathTemplate: "/rest/v1/recipes", sdk: { package: "io.github.jan-tennert.supabase:postgrest-kt" } });
    expect(at(r, "Recipes.kt", 28)).toMatchObject({ method: "DELETE", host: "{project}.supabase.co" });
    expect(at(r, "Recipes.kt", 30)).toMatchObject({ pathTemplate: "/rest/v1/rpc/popular_recipes" });
    expect(at(r, "Recipes.kt", 32)).toMatchObject({ pathTemplate: "/auth/v1/token", sdk: { package: "io.github.jan-tennert.supabase:auth-kt" } });
    expect(at(r, "Recipes.kt", 37)).toMatchObject({ pathTemplate: "/storage/v1/object/photos/recipes/{name}.jpg" });
    expect(at(r, "Recipes.kt", 42)).toMatchObject({ pathTemplate: "/functions/v1/translate-recipe", body: { properties: { id: { type: "integer" } } } });
    expect(r.calls.some((c) => c.location.line === 40)).toBe(false);
    // `db["tags"]` on an injected `Postgrest`: its `get` operator
    expect(at(r, "Recipes.kt", 45)).toMatchObject({ method: "GET", pathTemplate: "/rest/v1/tags", sdk: { chain: "get.select" } });
  });

  it("reads SendGrid requests, Resend and Mailgun builders", async () => {
    const r = await scanFixture("java/email");
    expect(at(r, "Mailer.java", 25)).toMatchObject({ provider: "sendgrid", method: "POST", urlTemplate: "https://api.sendgrid.com/v3/mail/send" });
    expect(at(r, "Mailer.java", 29)).toMatchObject({ provider: "resend", pathTemplate: "/emails", body: { properties: { from: { enum: ["billing@example.com"] }, reply_to: { enum: ["support@example.com"] } } } });
    expect(at(r, "Mailer.java", 33)).toMatchObject({ provider: "mailgun", urlTemplate: "https://api.mailgun.net/v3/mail.example.com/messages", bodyEncoding: "multipart", body: { properties: { subject: { enum: ["Weekly digest"] } } } });
  });
});

describe("kotlin and java: JDA and Vertex AI", () => {
  it("reads JDA actions through the types listeners are handed, at the action call", async () => {
    const r = await scanFixture("kotlin/sdk/discord");
    const messages = "/api/v10/channels/{channel_id}/messages";
    expect(at(r, "HarborBot.kt", 19)).toMatchObject({ provider: "discord", method: "POST", host: "discord.com", pathTemplate: messages, authScheme: "apikey", sdk: { package: "net.dv8tion:JDA" }, body: { properties: { content: { enum: ["ahoy"] } } } });
    expect(at(r, "HarborBot.kt", 20)).toMatchObject({ method: "POST", pathTemplate: messages, sdk: { chain: "reply" } });
    expect(at(r, "HarborBot.kt", 21)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me" });
    // a slash command's `reply` is the interaction callback, not a message's reply
    expect(at(r, "HarborBot.kt", 27)).toMatchObject({ method: "POST", pathTemplate: "/api/v10/interactions/{interaction_id}/{interaction_token}/callback", body: { properties: { data: { properties: { content: { enum: ["pong"] } } } } } });
    expect(at(r, "HarborBot.kt", 30)).toMatchObject({ method: "PATCH", pathTemplate: "/api/v10/webhooks/{application_id}/{interaction_token}/messages/@original" });
    expect(at(r, "HarborBot.kt", 38)).toMatchObject({ pathTemplate: "/api/v10/channels/1200000000000000001/messages" });
    expect(at(r, "HarborBot.kt", 42)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/applications/{application_id}/commands" });
    expect(at(r, "HarborBot.kt", 47)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/guilds/{guild_id}/members/{user_id}/roles/{role_id}" });
    expect(at(r, "HarborBot.kt", 51)).toMatchObject({ method: "DELETE", pathTemplate: "/api/v10/guilds/{guild_id}/members/{user_id}" });
    expect(at(r, "HarborBot.kt", 61)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/users/@me", sdk: { chain: "build" } });
    // the terminal (`queue`, `complete`, `submit`) is no call of its own
    expect(r.calls.filter((c) => c.location.line === 19)).toHaveLength(1);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["net.dv8tion:JDA", "ok"]]);
  });

  it("reads JDA getters from Java and tells a guild's commands from the application's", async () => {
    const r = await scanFixture("java/sdk-jda");
    expect(at(r, "Quartermaster.java", 17)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/applications/{application_id}/commands" });
    expect(at(r, "Quartermaster.java", 23)).toMatchObject({ method: "POST", pathTemplate: "/api/v10/webhooks/{application_id}/{interaction_token}", body: { properties: { content: { enum: ["counting crates"] } } } });
    expect(at(r, "Quartermaster.java", 25)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/guilds/{guild_id}/bans/{user_id}" });
    expect(at(r, "Quartermaster.java", 30)).toMatchObject({ pathTemplate: "/api/v10/interactions/{interaction_id}/{interaction_token}/callback" });
    expect(at(r, "Quartermaster.java", 34)).toMatchObject({ pathTemplate: "/api/v10/applications/{application_id}/guilds/1400000000000000003/commands" });
    expect(at(r, "Quartermaster.java", 36)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/guilds/1400000000000000003/members/1500000000000000004" });
    expect(at(r, "Quartermaster.java", 40)).toMatchObject({ method: "DELETE", pathTemplate: "/api/v10/channels/{channel_id}/messages/1600000000000000005" });
  });

  it("reads Vertex AI generative models with the project and location of the VertexAI construction", async () => {
    const r = await scanFixture("java/sdk-vertexai");
    const model = (m: string, verb: string): string => `/v1/projects/atlas-notes-prod/locations/europe-west4/publishers/google/models/${m}:${verb}`;
    expect(at(r, "Summarizer.java", 15)).toMatchObject({ provider: "google-vertex", method: "POST", pathTemplate: model("gemini-2.0-flash", "generateContent"), authScheme: "bearer", model: { values: ["gemini-2.0-flash"] } });
    expect(at(r, "Summarizer.java", 24)).toMatchObject({ pathTemplate: model("gemini-2.5-pro", "streamGenerateContent"), model: { values: ["gemini-2.5-pro"] } });
    expect(at(r, "Summarizer.java", 25)).toMatchObject({ pathTemplate: model("gemini-2.5-pro", "countTokens") });
    expect(at(r, "Summarizer.java", 32)).toMatchObject({ pathTemplate: model("gemini-2.0-flash-lite", "generateContent"), sdk: { chain: "startChat.sendMessage" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status, s.calls])).toEqual([["com.google.cloud:google-cloud-vertexai", "ok", 4]]);
  });
});
