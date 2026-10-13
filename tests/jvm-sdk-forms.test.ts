import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("kotlin: more forms of the supported JVM SDKs (#50)", () => {
  it("reads builders filled in apply { }, fields set in a branch and path ids inside a params object", async () => {
    const r = await scanFixture("kotlin/sdk/forms");
    expect(at(r, "Drafts.kt", 13)).toMatchObject({
      host: "llm-proxy.example.com",
      body: { properties: { model: { enum: ["gpt-4o-mini"] }, messages: { type: "array" } }, required: ["model", "messages"] },
      model: { values: ["gpt-4o-mini"] },
    });
    // `temperature` is set in an `if`, `max_completion_tokens` in `params.apply { }`
    expect(at(r, "Drafts.kt", 25)).toMatchObject({ body: { properties: { temperature: { enum: [0] }, max_completion_tokens: { enum: [800] } }, required: ["model", "messages", "max_completion_tokens"] } });
    expect(at(r, "Drafts.kt", 29)).toMatchObject({ method: "GET", pathTemplate: "/v1/files/{file_id}", dynamic: [{ where: "path", name: "file_id", origin: "param" }] });
  });

  it("reads Twilio creator arguments and setters as form fields, Slack incoming webhooks", async () => {
    const r = await scanFixture("kotlin/sdk/messaging");
    expect(at(r, "Notifier.kt", 23)).toMatchObject({
      bodyEncoding: "form",
      body: { properties: { To: { type: "string" }, From: { type: "string" }, Body: { type: "string" }, StatusCallback: { enum: ["https://alerts.example.com/status"] } } },
    });
    // the service id is a path argument, not a field
    expect(at(r, "Notifier.kt", 29)).toMatchObject({ body: { properties: { To: { type: "string" }, Channel: { enum: ["sms"] } }, required: ["To", "Channel"] } });
    expect(at(r, "Notifier.kt", 43)).toMatchObject({
      provider: "slack",
      urlTemplate: "{env:SLACK_WEBHOOK_URL}",
      sdk: { chain: "getInstance.send" },
      body: { properties: { text: { type: "string" }, icon_emoji: { enum: [":bell:"] } } },
    });
    expect(at(r, "Notifier.kt", 45)).toMatchObject({ provider: "slack", host: "hooks.slack.com", pathTemplate: "/services/T000/B000/YYYY", authScheme: "none" });
  });
});
