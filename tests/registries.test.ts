import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("supabase-js", () => {
  it("reports one call per operation, with the table in the path and the host from createClient", async () => {
    const r = await scanFixture("sdk/supabase");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "sdk" && c.provider === "supabase")).toBe(true);
    expect(at(r, "tasks.ts", 4)).toMatchObject({ method: "GET", pathTemplate: "/rest/v1/tasks", hostKind: "env", envName: "SUPABASE_URL", host: "xyzcompany.supabase.co", sdk: { chain: "from.select" } });
    expect(at(r, "tasks.ts", 9)).toMatchObject({ method: "POST", pathTemplate: "/rest/v1/tasks", body: { type: "object", required: ["title", "project_id", "done"] } });
    expect(at(r, "tasks.ts", 12)).toMatchObject({ method: "POST", sdk: { chain: "from.upsert" } });
    expect(at(r, "tasks.ts", 14)).toMatchObject({ method: "PATCH", sdk: { chain: "from.update" } });
    expect(at(r, "tasks.ts", 16)).toMatchObject({ method: "DELETE", sdk: { chain: "from.delete" } });
    // `.insert().select()` and `.eq().single()` are the same request, not extra calls
    expect(r.calls.filter((c) => c.location.file === "tasks.ts" && [4, 9].includes(c.location.line))).toHaveLength(2);
    expect(r.calls.filter((c) => c.location.file === "tasks.ts" && c.location.line === 19).map((c) => c.pathTemplate)).toEqual(["/rest/v1/tasks", "/rest/v1/projects"]);
    expect(at(r, "tasks.ts", 23)).toMatchObject({ method: "POST", pathTemplate: "/rest/v1/rpc/project_stats", body: { properties: { project_id: { type: "number" } } } });
    expect(at(r, "tasks.ts", 26)).toMatchObject({ method: "GET", pathTemplate: "/auth/v1/user" });
    expect(at(r, "tasks.ts", 30)).toMatchObject({ method: "POST", pathTemplate: "/auth/v1/token", query: ["grant_type"] });
    expect(at(r, "tasks.ts", 33)).toMatchObject({ method: "POST", pathTemplate: "/storage/v1/object/avatars/{userId}/avatar.png", bodyEncoding: "raw" });
    expect(at(r, "tasks.ts", 36)).toMatchObject({ method: "POST", pathTemplate: "/functions/v1/notify-assignee", body: { type: "object", properties: { taskId: { type: "string" } } } });
  });

  it("follows clients passed as typed parameters and local factories", async () => {
    const r = await scanFixture("sdk/supabase");
    expect(at(r, "context.ts", 9)).toMatchObject({ method: "GET", pathTemplate: "/rest/v1/projects", host: "{project}.supabase.co" });
    expect(at(r, "context.ts", 16)).toMatchObject({ method: "PATCH", pathTemplate: "/rest/v1/projects" });
    expect(at(r, "ssr.ts", 9)).toMatchObject({ pathTemplate: "/rest/v1/invoices", host: "abcdefgh.supabase.co", hostKind: "literal" });
    expect(at(r, "ssr.ts", 12)).toMatchObject({ pathTemplate: "/rest/v1/invoices", host: "abcdefgh.supabase.co" });
  });
});

describe("firebase modular sdk", () => {
  it("reads document paths from references and skips signOut", async () => {
    const r = await scanFixture("sdk/firebase-modular");
    expect(r).toMatchSnapshot();
    const docs = "/v1/projects/{projectId}/databases/(default)/documents";
    expect(at(r, "store.ts", 4)).toMatchObject({ provider: "firebase", method: "GET", host: "firestore.googleapis.com", pathTemplate: `${docs}/profiles/{uid}` });
    expect(at(r, "store.ts", 8)).toMatchObject({ method: "GET", pathTemplate: `${docs}/orders`, sdk: { chain: "getDocs" } });
    expect(at(r, "store.ts", 12)).toMatchObject({ method: "PATCH", pathTemplate: `${docs}/profiles/{uid}`, body: { type: "object", required: ["name", "city"] } });
    expect(at(r, "store.ts", 17)).toMatchObject({ method: "POST", pathTemplate: `${docs}/orders/{orderId}/comments` });
    expect(at(r, "store.ts", 20)).toMatchObject({ method: "PATCH", pathTemplate: `${docs}/{ref}` });
    expect(at(r, "store.ts", 22)).toMatchObject({ method: "DELETE", pathTemplate: `${docs}/orders/{orderId}` });
    expect(at(r, "store.ts", 24)).toMatchObject({ sdk: { chain: "onSnapshot" } });
    expect(at(r, "session.ts", 4)).toMatchObject({ host: "identitytoolkit.googleapis.com", pathTemplate: "/v1/accounts:signInWithIdp", query: ["key"] });
    expect(at(r, "session.ts", 6)).toMatchObject({ pathTemplate: "/v1/accounts:signUp" });
    expect(at(r, "session.ts", 8)).toMatchObject({ pathTemplate: "/v1/accounts:signInWithPassword" });
    expect(at(r, "session.ts", 8).examples[0]!.headers).toEqual({});
    expect(r.calls.some((c) => c.location.file === "session.ts" && c.location.line === 10)).toBe(false);
  });
});

describe("sentry", () => {
  it("reports capture calls from any @sentry package, inside a local wrapper but not at its callers, and not init", async () => {
    const r = await scanFixture("sdk/sentry");
    expect(r).toMatchSnapshot();
    // `reportError(err)` sends the same request from every caller: only the capture inside it is a call
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.sdk?.chain, c.via ?? null])).toEqual([
      ["checkout.ts", 8, "captureException", null],
      ["monitoring.ts", 6, "captureException", null],
      ["monitoring.ts", 9, "captureMessage", null],
    ]);
    expect(r.calls.every((c) => c.provider === "sentry" && c.method === "POST" && c.pathTemplate === "/api/{projectId}/envelope")).toBe(true);
  });
});
