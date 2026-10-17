import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

/** SDKs imported where the scan used to find no call: clients built behind a guard, re-exported, in monorepo packages. */
describe("imported SDKs without calls", () => {
  it("resolves the path aliases of each monorepo package with its own tsconfig", async () => {
    const r = await scanFixture("monorepo-aliases", { exclude: [] });
    const api = r.calls.filter((c) => c.location.file === "apps/api/src/routes/hives.ts");
    expect(api.map((c) => [c.location.line, c.provider, c.pathTemplate])).toEqual([
      [4, "supabase", "/auth/v1/user"],
      [5, "supabase", "/rest/v1/hives"],
      [10, "stripe", "/v1/subscriptions"],
    ]);
    // the web app's `@/lib/db` is its own module, not the API's client
    expect(r.calls.filter((c) => c.location.file === "apps/web/src/pages/hives.ts").map((c) => c.provider)).toEqual(["internal"]);
    expect(r.coverage!.sdks.map((s) => [s.package, s.status])).toEqual([
      ["@supabase/supabase-js", "ok"],
      ["stripe", "ok"],
    ]);
  });

  it("reports an AI SDK call once per provider its model is picked among", async () => {
    const r = await scanFixture("sdk/ai-sdk-providers");
    const atLine = (line: number) => r.calls.filter((c) => c.location.file === "route.ts" && c.location.line === line);
    expect(atLine(5).map((c) => [c.provider, c.model?.values])).toEqual([["vercel-ai-gateway", ["anthropic/claude-sonnet-4-5"]]]);
    expect(atLine(6).map((c) => c.model?.values)).toEqual([["anthropic/claude-sonnet-4-5", "mistral/mistral-small"]]);
    expect(atLine(7)[0]).toMatchObject({ provider: "anthropic", model: { values: ["claude-haiku-4-5"] } });
    for (const line of [8, 15]) {
      expect(atLine(line).map((c) => [c.provider, c.model?.values, c.hostAlternatives])).toEqual([
        ["anthropic", ["claude-opus-4-1"], ["api.anthropic.com", "api.mistral.ai"]],
        ["mistral", ["mistral-large-latest"], ["api.anthropic.com", "api.mistral.ai"]],
      ]);
      expect(new Set(atLine(line).map((c) => c.id)).size).toBe(2);
    }
    // one provider, two models: one call naming both
    expect(atLine(16).map((c) => [c.provider, c.model?.values, c.hostAlternatives])).toEqual([["mistral", ["mistral-small-latest", "mistral-large-latest"], undefined]]);
    expect(at(r, "untraced.ts", 12)).toMatchObject({ provider: "unknown" });
    expect(at(r, "untraced.ts", 14)).toMatchObject({ provider: "unknown" });
  });

  it("follows SDK modules loaded on demand into a variable", async () => {
    const r = await scanFixture("sdk/lazy-modules");
    expect(at(r, "subscriptions.ts", 31)).toMatchObject({ provider: "revenuecat", sdk: { package: "@revenuecat/purchases-js" } });
    expect(at(r, "telemetry.ts", 35)).toMatchObject({ provider: "posthog", host: "eu.i.posthog.com", sdk: { package: "posthog-react-native" } });
    // a variable given two packages' modules names neither
    expect(r.calls.some((c) => c.location.file === "telemetry.ts" && c.location.line === 36)).toBe(false);
  });

  it("reads boto3's DynamoDB, SES, SQS and SNS clients and resources", async () => {
    const r = await scanFixture("python/sdk-aws");
    expect(at(r, "orders.py", 9)).toMatchObject({ host: "dynamodb.{region}.amazonaws.com", pathTemplate: "/", operationId: "PutItem", sdk: { chain: "Table.put_item" } });
    expect(at(r, "orders.py", 11)).toMatchObject({ operationId: "BatchWriteItem" });
    expect(at(r, "orders.py", 30)).toMatchObject({ host: "email.{region}.amazonaws.com", operationId: "SendEmail", bodyEncoding: "form" });
    expect(at(r, "notify.py", 12)).toMatchObject({ host: "sqs.{region}.amazonaws.com", operationId: "SendMessage", sdk: { chain: "get_queue_by_name.send_message" } });
    expect(at(r, "notify.py", 16)).toMatchObject({ host: "sns.{region}.amazonaws.com", operationId: "Publish" });
    expect(at(r, "notify.py", 20)).toMatchObject({ pathTemplate: "/v2/email/outbound-emails", operationId: "SendEmail" });
    expect(at(r, "notify.py", 24)).toMatchObject({ method: "GET", pathTemplate: "/v2/email/identities/{EmailIdentity}" });
    expect(r.calls.some((c) => c.location.file === "notify.py" && c.location.line === 29)).toBe(false);
  });
});
