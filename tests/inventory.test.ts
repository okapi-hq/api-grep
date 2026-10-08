import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { scanFixture } from "./fixture-helpers.js";

/** `file:line provider METHOD host/path` per call: the whole answer for a provider fixture, in one readable list. */
async function calls(name: string): Promise<string[]> {
  const r: Report = await scanFixture(name, { examples: 0 });
  return r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider} ${c.method} ${c.host ?? `{env:${c.envName}}`}${c.pathTemplate}`);
}

describe("provider inventory: LLM SDKs", () => {
  it("anthropic", async () => {
    expect(await calls("sdk/anthropic")).toEqual([
      "claude.ts:6 anthropic POST api.anthropic.com/v1/messages",
      "claude.ts:10 anthropic POST api.anthropic.com/v1/messages",
      "claude.ts:12 anthropic POST api.anthropic.com/v1/messages/count_tokens",
      "claude.ts:14 anthropic GET api.anthropic.com/v1/models",
    ]);
  });

  it("gemini, both SDKs, with the model in the path", async () => {
    expect(await calls("sdk/gemini")).toEqual([
      "genai.ts:6 google-ai POST generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      "genai.ts:12 google-ai POST generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      "legacy.ts:7 google-ai POST generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    ]);
  });

  it("the OpenAI SDK pointed at another service by baseURL", async () => {
    expect(await calls("sdk/openai-compatible")).toEqual([
      "clients.ts:8 openrouter POST openrouter.ai/api/v1/chat/completions",
      "clients.ts:9 groq POST {env:GROQ_BASE_URL}/chat/completions",
      "clients.ts:10 ollama POST localhost:11434/v1/chat/completions",
      "clients.ts:11 openai POST api.openai.com/v1/embeddings",
    ]);
  });

  it("vercel ai sdk: the provider comes from the model", async () => {
    expect(await calls("sdk/ai-sdk")).toEqual([
      "generate.ts:11 openai POST api.openai.com/v1/responses",
      "generate.ts:12 anthropic POST api.anthropic.com/v1/messages",
      "generate.ts:13 google-ai POST generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      "generate.ts:14 openai POST api.openai.com/v1/embeddings",
      "generate.ts:15 together POST api.together.xyz/v1/responses",
      "generate.ts:16 vercel-ai-gateway POST ai-gateway.vercel.sh/v1/ai/language-model",
      "generate.ts:17 openrouter POST openrouter.ai/api/v1/chat/completions",
      "generate.ts:20 google-vertex POST aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-2.5-flash:generateContent",
      "generate.ts:21 unknown POST {provider}/",
    ]);
  });

  it("aws bedrock commands", async () => {
    expect(await calls("sdk/bedrock")).toEqual([
      "invoke.ts:6 aws-bedrock POST bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse",
      "invoke.ts:10 aws-bedrock POST bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke",
    ]);
  });

  it("mcp, with the server URL from the transport", async () => {
    expect(await calls("sdk/mcp")).toEqual(["tools.ts:9 mcp POST mcp.example-tools.dev/mcp", "tools.ts:10 mcp POST mcp.example-tools.dev/mcp"]);
  });
});

describe("provider inventory: product SDKs", () => {
  it("resend", async () => {
    expect(await calls("sdk/resend")).toEqual(["mail.ts:5 resend POST api.resend.com/emails", "mail.ts:7 resend POST api.resend.com/audiences/{audienceId}/contacts"]);
  });

  it("revenuecat", async () => {
    expect(await calls("sdk/revenuecat")).toEqual([
      "paywall.ts:4 revenuecat GET api.revenuecat.com/v1/subscribers/{app_user_id}/offerings",
      "paywall.ts:8 revenuecat POST api.revenuecat.com/v1/receipts",
      "paywall.ts:10 revenuecat GET api.revenuecat.com/v1/subscribers/{app_user_id}",
    ]);
  });

  it("lemon squeezy (setup is not a call)", async () => {
    expect(await calls("sdk/lemonsqueezy")).toEqual([
      "billing.ts:5 lemonsqueezy POST api.lemonsqueezy.com/v1/checkouts",
      "billing.ts:7 lemonsqueezy GET api.lemonsqueezy.com/v1/subscriptions/{id}",
      "billing.ts:9 lemonsqueezy DELETE api.lemonsqueezy.com/v1/subscriptions/{id}",
    ]);
  });

  it("posthog (init and local flag reads are not calls)", async () => {
    expect(await calls("sdk/posthog")).toEqual([
      "server.ts:5 posthog POST eu.i.posthog.com/batch",
      "server.ts:7 posthog POST eu.i.posthog.com/flags",
      "web.ts:5 posthog POST us.i.posthog.com/e",
      "web.ts:7 posthog POST us.i.posthog.com/e",
    ]);
  });

  it("convex clients and hooks, but not function definitions", async () => {
    expect(await calls("sdk/convex")).toEqual([
      "app.tsx:8 convex POST {deployment}.convex.cloud/api/run/tasks/list",
      "app.tsx:9 convex POST {deployment}.convex.cloud/api/run/tasks/create",
      "app.tsx:13 convex POST {env:NEXT_PUBLIC_CONVEX_URL}/api/run/reports/weekly/summary",
    ]);
  });
});
