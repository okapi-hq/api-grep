import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();
const pathOrigins = (c: Call): Record<string, string> => Object.fromEntries(c.dynamic.filter((d) => d.where === "path").map((d) => [d.name, d.origin]));

describe("email SDKs (TypeScript)", () => {
  it("@getbrevo/brevo: 1.x to 3.x API classes, 4.x on BrevoClient; sib-api-v3-sdk on its own host", async () => {
    const r = await scanFixture("sdk/brevo");
    // a model built with `new SendSmtpEmail()` and filled by property sets is the body
    expect(at(r, "mailer.ts", 12)).toMatchObject({ provider: "brevo", method: "POST", host: "api.brevo.com", pathTemplate: "/v3/smtp/email", authScheme: "apikey", sdk: { package: "@getbrevo/brevo", chain: "TransactionalEmailsApi.sendTransacEmail" } });
    expect(keys(at(r, "mailer.ts", 12))).toEqual(["htmlContent", "sender", "subject", "to"]);
    expect(keys(at(r, "mailer.ts", 16))).toEqual(["params", "templateId", "to"]);
    expect(at(r, "mailer.ts", 21)).toMatchObject({ method: "POST", pathTemplate: "/v3/contacts", sdk: { chain: "ContactsApi.createContact" } });
    expect(at(r, "mailer.ts", 23)).toMatchObject({ method: "PUT", pathTemplate: "/v3/contacts/{identifier}" });
    expect(keys(at(r, "mailer.ts", 23))).toEqual(["attributes"]);
    expect(at(r, "mailer.ts", 25)).toMatchObject({ method: "POST", pathTemplate: "/v3/contacts/lists/{listId}/contacts/add" });
    // positional query parameters are not read
    expect(at(r, "mailer.ts", 27)).toMatchObject({ method: "GET", pathTemplate: "/v3/contacts", query: [] });
    expect(at(r, "mailer.ts", 31)).toMatchObject({ method: "POST", pathTemplate: "/v3/transactionalSMS/sms" });
    // 4.x on: the request object's path ids and query keys are not in the body
    expect(at(r, "client.ts", 6)).toMatchObject({ pathTemplate: "/v3/smtp/email", sdk: { chain: "transactionalEmails.sendTransacEmail" } });
    expect(at(r, "client.ts", 8)).toMatchObject({ method: "GET", pathTemplate: "/v3/contacts/{identifier}", query: ["identifierType"] });
    expect(at(r, "client.ts", 10)).toMatchObject({ method: "PUT", pathTemplate: "/v3/contacts/{identifier}", query: ["identifierType"] });
    expect(keys(at(r, "client.ts", 10))).toEqual(["attributes"]);
    expect(keys(at(r, "client.ts", 12))).toEqual(["emails"]);
    expect(at(r, "client.ts", 14)).toMatchObject({ method: "GET", pathTemplate: "/v3/contacts", query: ["limit", "sort"] });
    expect(at(r, "legacy.js", 8)).toMatchObject({ host: "api.sendinblue.com", pathTemplate: "/v3/smtp/email", sdk: { package: "sib-api-v3-sdk" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@getbrevo/brevo", "ok"], ["sib-api-v3-sdk", "ok"]]);
  });

  it("@emailjs/browser, @emailjs/nodejs, emailjs-com: send as JSON, sendForm as form data", async () => {
    const r = await scanFixture("sdk/emailjs");
    expect(at(r, "ContactForm.tsx", 8)).toMatchObject({ provider: "emailjs", method: "POST", host: "api.emailjs.com", pathTemplate: "/api/v1.0/email/send-form", bodyEncoding: "multipart", authScheme: "none" });
    // the form's own fields are not known
    expect(at(r, "ContactForm.tsx", 8).body).toMatchObject({ dynamicKeys: true, properties: { service_id: { enum: ["service_meadow"] }, template_id: { enum: ["template_contact"] } } });
    expect(at(r, "ContactForm.tsx", 13)).toMatchObject({ pathTemplate: "/api/v1.0/email/send", bodyEncoding: "json" });
    expect(keys(at(r, "ContactForm.tsx", 13))).toEqual(["service_id", "template_id", "template_params"]);
    expect(at(r, "server.ts", 4)).toMatchObject({ pathTemplate: "/api/v1.0/email/send", sdk: { package: "@emailjs/nodejs" } });
    expect(at(r, "legacy.js", 4)).toMatchObject({ pathTemplate: "/api/v1.0/email/send", sdk: { package: "emailjs-com" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@emailjs/browser", "ok"], ["@emailjs/nodejs", "ok"], ["emailjs-com", "ok"]]);
  });
});

describe("cloudflare (npm)", () => {
  it("Stainless client: path ids from the params object, the rest as the body or query", async () => {
    const r = await scanFixture("sdk/cloudflare");
    expect(at(r, "infra.ts", 6)).toMatchObject({ provider: "cloudflare", method: "GET", host: "api.cloudflare.com", pathTemplate: "/client/v4/zones", query: ["name"], authScheme: "unknown" });
    expect(at(r, "infra.ts", 11)).toMatchObject({ method: "POST", pathTemplate: "/client/v4/zones/{zone_id}/dns_records", bodyEncoding: "json" });
    expect(keys(at(r, "infra.ts", 11))).toEqual(["content", "name", "proxied", "ttl", "type"]);
    expect(pathOrigins(at(r, "infra.ts", 11))).toEqual({ zone_id: "param" });
    expect(at(r, "infra.ts", 13)).toMatchObject({ method: "GET", pathTemplate: "/client/v4/zones/{zone_id}/dns_records", query: ["type", "per_page"] });
    expect(at(r, "infra.ts", 15)).toMatchObject({ method: "PUT", pathTemplate: "/client/v4/zones/{zone_id}/dns_records/{dns_record_id}" });
    expect(keys(at(r, "infra.ts", 15))).toEqual(["content", "name", "type"]);
    expect(at(r, "infra.ts", 19)).toMatchObject({ method: "POST", pathTemplate: "/client/v4/zones/{zone_id}/purge_cache" });
    // Workers AI: the model is in the path
    expect(at(r, "infra.ts", 21)).toMatchObject({ method: "POST", pathTemplate: "/client/v4/accounts/{account_id}/ai/run/{model_name}", model: { values: ["@cf/llava-hf/llava-1.5-7b-hf"] } });
    expect(keys(at(r, "infra.ts", 21))).toEqual(["image", "prompt"]);
    expect(at(r, "infra.ts", 23)).toMatchObject({ pathTemplate: "/client/v4/accounts/{account_id}/ai/run/{model_name}", model: { values: ["@cf/meta/llama-3-8b-instruct"] }, sdk: { chain: "workers.ai.run" } });
    expect(at(r, "infra.ts", 26)).toMatchObject({ method: "PUT", pathTemplate: "/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}", bodyEncoding: "multipart" });
    expect(keys(at(r, "infra.ts", 26))).toEqual(["metadata", "value"]);
    // 4.x `get(namespaceId, key, params)` and 7.x `get(key, { namespace_id })` read the same ids
    for (const line of [28, 30]) expect(pathOrigins(at(r, "infra.ts", line))).toEqual({ account_id: "env", namespace_id: "param", key_name: "param" });
    expect(keys(at(r, "infra.ts", 32))).toEqual(["params", "sql"]);
    expect(at(r, "infra.ts", 38)).toMatchObject({ method: "GET", pathTemplate: "/client/v4/accounts/{account_id}/pages/projects/{project_name}" });
    expect(keys(at(r, "infra.ts", 40))).toEqual(["paused"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["cloudflare", "ok"]]);
  });

  it("2.x: positional ids, then the body", async () => {
    const r = await scanFixture("sdk/cloudflare");
    expect(at(r, "legacy.js", 4)).toMatchObject({ method: "POST", pathTemplate: "/client/v4/zones/{zone_id}/dns_records", sdk: { chain: "dnsRecords.add" } });
    expect(keys(at(r, "legacy.js", 4))).toEqual(["content", "name", "type"]);
    expect(at(r, "legacy.js", 5)).toMatchObject({ method: "GET", pathTemplate: "/client/v4/zones/{zone_id}/dns_records" });
    expect(keys(at(r, "legacy.js", 8))).toEqual(["purge_everything"]);
    // `zones.edit(id, data)`, the 3.x `zones.edit({ zone_id, ...data })` form aside
    expect(at(r, "legacy.js", 10)).toMatchObject({ method: "PATCH", pathTemplate: "/client/v4/zones/{zone_id}" });
    expect(keys(at(r, "legacy.js", 10))).toEqual(["paused"]);
    expect(pathOrigins(at(r, "legacy.js", 10))).toEqual({ zone_id: "param" });
  });
});
