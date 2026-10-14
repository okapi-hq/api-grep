import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("java: remaining JVM SDK forms (#89)", () => {
  it("reads the method set on a SendGrid request and Mailgun's EU host", async () => {
    const r = await scanFixture("java/sdk-forms");
    expect(at(r, "Notices.java", 19)).toMatchObject({ method: "GET", urlTemplate: "https://api.sendgrid.com/v3/suppression/bounces", bodyEncoding: "none" });
    expect(at(r, "Notices.java", 26)).toMatchObject({ method: "DELETE", pathTemplate: "/v3/asm/suppressions/global/{email}" });
    // no method set: the method of `mail/send`; a method from a parameter is not known
    expect(at(r, "Notices.java", 34)).toMatchObject({ method: "POST", pathTemplate: "/v3/mail/send" });
    expect(at(r, "Notices.java", 41)).toMatchObject({ method: "DYNAMIC", dynamic: [{ where: "method", origin: "param" }, { where: "path", name: "endpoint" }] });
    expect(at(r, "Notices.java", 45)).toMatchObject({ provider: "mailgun", urlTemplate: "https://api.eu.mailgun.net/v3/notices.example.eu/messages" });
    // `config(key)` takes no URL
    expect(at(r, "Notices.java", 49)).toMatchObject({ urlTemplate: "https://api.mailgun.net/v3/notices.example.com/messages" });
  });

  it("reads Azure OpenAI option objects filled by setters, chained or on a variable", async () => {
    const r = await scanFixture("java/sdk-forms");
    expect(at(r, "Assistant.java", 27).body).toMatchObject({
      properties: { messages: { type: "array" }, max_tokens: { enum: [400] }, user: { enum: ["notices"] }, temperature: { enum: [0.9] } },
      required: ["messages", "max_tokens", "user"],
    });
    expect(at(r, "Assistant.java", 31).body).toMatchObject({ properties: { prompt: { type: "string" }, n: { enum: [1] }, size: {} }, required: ["prompt", "n", "size"] });
  });

  it("reads SDK builders made by a factory method or filled by a helper", async () => {
    const r = await scanFixture("java/sdk-forms");
    expect(at(r, "Drafts.java", 24).body).toMatchObject({ properties: { model: { enum: ["claude-sonnet-4-5"] }, max_tokens: { enum: [1024] }, messages: { type: "array" } }, required: ["model", "max_tokens", "messages"] });
    // the helper's `temperature` is set in a branch
    expect(at(r, "Drafts.java", 31).body).toMatchObject({ properties: { system: { enum: ["You write short notices."] }, temperature: { enum: [0.2] } }, required: ["model", "max_tokens", "system", "messages"] });
  });
});

describe("kotlin: remaining JVM SDK forms (#89)", () => {
  it("reads builders across functions, supabase-kt lambda bodies and Firebase Storage properties", async () => {
    const r = await scanFixture("kotlin/sdk/split");
    expect(r).toMatchSnapshot();
    expect(at(r, "Lessons.kt", 22).body).toMatchObject({ properties: { model: { enum: ["gpt-4o-mini"] }, max_completion_tokens: { enum: [600] } }, required: ["model", "max_completion_tokens", "messages"] });
    expect(at(r, "Lessons.kt", 28).body).toMatchObject({ properties: { temperature: { enum: [0.3] } }, required: ["model", "max_completion_tokens", "messages"] });
    expect(at(r, "Lessons.kt", 31)).toMatchObject({ method: "PATCH", pathTemplate: "/rest/v1/lessons", body: { properties: { done: { enum: [true] }, score: { type: "integer" } }, required: ["done", "score"] } });
    // a key put in a nested lambda (`title?.let { ... }`) may not be sent
    expect(at(r, "Lessons.kt", 39).body).toMatchObject({ properties: { title: {} }, required: [] });
    expect(at(r, "Lessons.kt", 45)).toMatchObject({ pathTemplate: "/auth/v1/signup", body: { properties: { phone: { type: "string" }, password: { type: "string" } } } });
    expect(at(r, "Lessons.kt", 50)).toMatchObject({ provider: "firebase", method: "GET", pathTemplate: "/v0/b/{bucket}/o/covers/{id}.png", sdk: { chain: "downloadUrl" } });
    expect(r.calls).toHaveLength(6);
  });
});
