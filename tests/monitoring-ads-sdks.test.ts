import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();

describe("Bugsnag (npm)", () => {
  it("notify and the session start send, at the endpoints the code gives", async () => {
    const r = await scanFixture("sdk/bugsnag");
    const base = { provider: "bugsnag", method: "POST", authScheme: "apikey" };
    // `start` starts a session: autoTrackSessions is true by default
    expect(at(r, "monitoring.ts", 3)).toMatchObject({ ...base, host: "sessions.bugsnag.com", pathTemplate: "/", sdk: { package: "@bugsnag/js", chain: "start" } });
    expect(at(r, "monitoring.ts", 7)).toMatchObject({ ...base, host: "notify.bugsnag.com", pathTemplate: "/", sdk: { chain: "notify" } });
    expect(at(r, "monitoring.ts", 11)).toMatchObject({ ...base, host: "notify.bugsnag.com" });
    // the endpoints of the construction; `autoTrackSessions: false` starts no session there
    expect(at(r, "onprem.ts", 9)).toMatchObject({ ...base, host: "bugs.lanternfish.example", pathTemplate: "/notify", sdk: { package: "@bugsnag/browser" } });
    expect(at(r, "onprem.ts", 11)).toMatchObject({ ...base, host: "bugs.lanternfish.example", pathTemplate: "/sessions", sdk: { chain: "startSession" } });
    // the Node build's `start` starts no session
    expect(at(r, "server.js", 6)).toMatchObject({ ...base, host: "notify.bugsnag.com", sdk: { package: "@bugsnag/node", chain: "notify" } });
    expect(r.calls).toHaveLength(6);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["@bugsnag/browser", "ok"],
      ["@bugsnag/js", "ok"],
      ["@bugsnag/node", "ok"],
    ]);
  });
});

describe("facebook-nodejs-business-sdk", () => {
  it("CRUD objects' reads, writes and edges; Conversions API events", async () => {
    const r = await scanFixture("sdk/facebook-business");
    const base = { provider: "meta-graph", host: "graph.facebook.com", authScheme: "apikey" };
    expect(at(r, "ads.ts", 7)).toMatchObject({ ...base, method: "GET", pathTemplate: "/{version}/{id}/campaigns", query: ["fields", "access_token", "limit"], sdk: { package: "facebook-nodejs-business-sdk", chain: "AdAccount.getCampaigns" } });
    expect(at(r, "ads.ts", 9)).toMatchObject({ ...base, method: "POST", pathTemplate: "/{version}/{id}/campaigns", query: ["access_token"], bodySource: "literal" });
    expect(keys(at(r, "ads.ts", 9))).toEqual(["name", "objective", "status"]);
    expect(at(r, "ads.ts", 11)).toMatchObject({ method: "GET", pathTemplate: "/{version}/{id}/insights", query: ["fields", "access_token", "date_preset"] });
    expect(at(r, "ads.ts", 15)).toMatchObject({ method: "GET", pathTemplate: "/{version}/{id}", sdk: { chain: "Campaign.get" } });
    expect(at(r, "ads.ts", 16)).toMatchObject({ method: "POST", pathTemplate: "/{version}/{id}" });
    expect(keys(at(r, "ads.ts", 16))).toEqual(["status"]);
    // no fields given: none sent
    expect(at(r, "ads.ts", 17)).toMatchObject({ method: "DELETE", pathTemplate: "/{version}/{id}", query: ["access_token"] });
    expect(at(r, "ads.ts", 20)).toMatchObject({ method: "GET", pathTemplate: "/{version}/{id}/adaccounts", sdk: { chain: "User.getAdAccounts" } });
    // EventRequest(token, pixelId), whatever setters come before execute()
    expect(at(r, "capi.js", 11)).toMatchObject({ ...base, method: "POST", pathTemplate: "/{version}/{pixel_id}/events", sdk: { chain: "setEvents.execute" } });
    expect(at(r, "capi.js", 15)).toMatchObject({ method: "POST", pathTemplate: "/{version}/{pixel_id}/events", sdk: { chain: "setTestEventCode.execute" } });
    expect(at(r, "capi.js", 15).dynamic.map((d) => d.name)).not.toContain("pixel_id");
    expect(at(r, "capi.js", 18)).toMatchObject({ method: "GET", pathTemplate: "/{version}/{id}/owned_ad_accounts", sdk: { chain: "Business.getOwnedAdAccounts" } });
    expect(r.calls).toHaveLength(10);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["facebook-nodejs-business-sdk", "ok"]]);
  });
});
