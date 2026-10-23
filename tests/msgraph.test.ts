import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { msgraphSegment } from "../src/lang/python/msgraph.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();
const pathOrigins = (c: Call): Record<string, string> => Object.fromEntries(c.dynamic.filter((d) => d.where === "path").map((d) => [d.name, d.origin]));

describe("@microsoft/microsoft-graph-client (npm)", () => {
  it("api(path), its modifiers and the verb: version, path, OData query, body", async () => {
    const r = await scanFixture("sdk/msgraph");
    expect(at(r, "mail.ts", 6)).toMatchObject({
      provider: "microsoft",
      method: "GET",
      urlTemplate: "https://graph.microsoft.com/v1.0/me/messages",
      query: ["$select", "$top", "$orderby"],
      authScheme: "bearer",
      sdk: { package: "@microsoft/microsoft-graph-client", chain: "api.select.top.orderby.get" },
    });
    expect(at(r, "mail.ts", 6).queryShape).toMatchObject({ properties: { $select: { enum: ["subject,from"] }, $top: { enum: [10] } } });
    expect(at(r, "mail.ts", 10)).toMatchObject({ method: "POST", pathTemplate: "/v1.0/users/{userId}/sendMail", bodyEncoding: "json" });
    expect(keys(at(r, "mail.ts", 10))).toEqual(["message", "saveToSentItems"]);
    expect(pathOrigins(at(r, "mail.ts", 10))).toEqual({ userId: "param" });
    // the start of the chain held by a variable
    expect(at(r, "mail.ts", 15)).toMatchObject({ method: "PATCH", pathTemplate: "/v1.0/me/messages/{id}" });
    expect(keys(at(r, "mail.ts", 15))).toEqual(["isRead"]);
    expect(at(r, "mail.ts", 19)).toMatchObject({ method: "DELETE", pathTemplate: "/v1.0/me/messages/{id}", bodyEncoding: "none" });
    // a wrapper's callers give the path
    expect(at(r, "mail.ts", 26)).toMatchObject({ method: "GET", pathTemplate: "/v1.0/me", via: "wrapper:graphGet" });
  });

  it("a chain longer than six calls, query objects, full URLs, the client's base URL and default version", async () => {
    const r = await scanFixture("sdk/msgraph");
    expect(at(r, "calendar.ts", 12)).toMatchObject({ method: "GET", pathTemplate: "/beta/users/{userId}/events", query: ["$filter", "$expand", "$count", "$top"] });
    expect(at(r, "calendar.ts", 12).queryShape).toMatchObject({ properties: { $count: { enum: ["true"] }, $expand: { enum: ["attachments"] } } });
    expect(at(r, "calendar.ts", 16)).toMatchObject({ pathTemplate: "/v1.0/groups", query: ["$search"] });
    expect(at(r, "calendar.ts", 20)).toMatchObject({ urlTemplate: "https://graph.microsoft.com/beta/me/drive/root/children" });
    expect(at(r, "calendar.ts", 24)).toMatchObject({ method: "PUT", pathTemplate: "/v1.0/me/calendars/{id}", bodyEncoding: "json" });
    expect(at(r, "calendar.ts", 30)).toMatchObject({ urlTemplate: "https://graph.microsoft.us/beta/me" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@microsoft/microsoft-graph-client", "ok"]]);
  });
});

describe("msgraph-sdk and msgraph-beta-sdk (PyPI)", () => {
  it("request builders: camelCase segments, by_*_id values, the SDK's own segment names", async () => {
    const r = await scanFixture("python/sdk/msgraph");
    expect(at(r, "directory.py", 13)).toMatchObject({
      provider: "microsoft",
      method: "GET",
      urlTemplate: "https://graph.microsoft.com/v1.0/users/{user_id}/messages",
      authScheme: "bearer",
      sdk: { package: "msgraph-sdk", chain: "users.by_user_id.messages.get" },
    });
    expect(pathOrigins(at(r, "directory.py", 13))).toEqual({ user_id: "param" });
    // a model object body is not read
    expect(at(r, "directory.py", 18)).toMatchObject({ method: "POST", pathTemplate: "/v1.0/me/sendMail", bodyEncoding: "json" });
    expect(at(r, "directory.py", 24)).toMatchObject({ method: "GET", pathTemplate: "/v1.0/users", query: ["$select", "$top", "$filter"] });
    expect(at(r, "directory.py", 28)).toMatchObject({ pathTemplate: "/v1.0/groups/{group_id}/members/graph.user" });
    expect(at(r, "directory.py", 32)).toMatchObject({ pathTemplate: "/v1.0/sites/{site_id}/drive/items/{item_id}/content" });
    // `content` after a photo is the media stream, `count` the `$count` segment, `delta` a function
    expect(at(r, "directory.py", 36)).toMatchObject({ pathTemplate: "/v1.0/me/photo/$value" });
    expect(at(r, "directory.py", 40)).toMatchObject({ pathTemplate: "/v1.0/users/$count" });
    expect(at(r, "directory.py", 44)).toMatchObject({ pathTemplate: "/v1.0/users/delta()" });
    expect(at(r, "directory.py", 48)).toMatchObject({ method: "DELETE", pathTemplate: "/v1.0/me/messages/{message_id}" });
    // `with_url(link)` is not read: the path stays a placeholder
    expect(at(r, "directory.py", 52)).toMatchObject({ pathTemplate: "/v1.0/{path}" });
    expect(at(r, "beta.py", 9)).toMatchObject({ pathTemplate: "/beta/teams/{team_id}/channels", sdk: { package: "msgraph-beta-sdk" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["azure-identity", "unsupported"], ["msgraph-beta-sdk", "ok"], ["msgraph-sdk", "ok"]]);
  });

  it("segment names: rule, exceptions, names that depend on the segment before, unknown functions", () => {
    expect(msgraphSegment("msgraph", "send_mail", false, "me")).toBe("sendMail");
    expect(msgraphSegment("msgraph", "by_user_id", true, "users")).toBe(0);
    expect(msgraphSegment("msgraph", "delete_path", false, "by_event_id")).toBe("delete");
    expect(msgraphSegment("msgraph", "content", false, "by_drive_item_id")).toBe("content");
    expect(msgraphSegment("msgraph", "content", false, "by_message_id")).toBe("$value");
    // the same previous name under two parents that disagree: not known
    expect(msgraphSegment("msgraph", "count", false, "columns")).toBeUndefined();
    expect(msgraphSegment("msgraph", "microsoft_graph_security_apply_hold", false, "by_ediscovery_custodian_id")).toBe("microsoft.graph.security.applyHold");
    expect(msgraphSegment("msgraph", "delta_with_token", true, "users")).toBeUndefined();
    expect(msgraphSegment("msgraph", "with_url", true, "users")).toBeNull();
  });
});
