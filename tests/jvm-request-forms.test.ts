import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const summary = (r: Report, file: string): unknown[] => r.calls.filter((c) => c.location.file === file).map((c) => [c.location.line, c.client, c.method, c.urlTemplate]);
const parts = (r: Report, file: string, line: number): unknown => at(r, file, line).clientParts?.map((p) => `${p.name}:${p.from}`);
const bodies = (r: Report, file: string, line: number): unknown[] => r.calls.filter((c) => c.location.file === file && c.location.line === line).map((c) => [c.method, c.bodyEncoding]);

describe("jvm: requests started in several places (#73)", () => {
  it("reads a factory with several returns as one call, as a helper with several returns, and starts in branches as one call each", async () => {
    const r = await scanFixture("java/request-factories");
    expect(r).toMatchSnapshot();
    // the first return; the method a static-imported constant
    expect(summary(r, "Catalog.java")).toEqual([
      [24, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/items"],
      [29, "jaxrs-client", "DELETE", "https://api.example-catalog.com/{version}/items/{id}"],
      [33, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/stats"],
      [46, "jaxrs-client", "DYNAMIC", ""],
      // the response type given as an anonymous `GenericType` is not a body
      [53, "jaxrs-client", "GET", "https://api.example-catalog.com/{version}/names"],
      [58, "jaxrs-client", "DYNAMIC", ""],
    ]);
    expect(at(r, "Catalog.java", 53).bodyEncoding).toBe("none");
    // a factory returning a POST or a GET: one call, its method unknown
    expect(summary(r, "Ledger.java")[0]).toEqual([25, "apache-httpclient", "DYNAMIC", "https://api.example-ledger.com/v2/entries"]);
    // a switch expression: one call per start
    expect(summary(r, "Notices.java").slice(-2)).toEqual([
      [45, "async-http-client", "PUT", "{url}"],
      [45, "async-http-client", "GET", "{url}"],
    ]);
    // a body set after the split is not the GET's
    expect(bodies(r, "Uploads.java", 27)).toEqual([
      ["GET", "none"],
      ["POST", "json"],
    ]);
    expect(new Set(r.calls.map((c) => c.id)).size).toBe(r.calls.length);
  });

  it("runs the overload of a wrapper its arguments fit", async () => {
    const r = await scanFixture("java/request-factories");
    expect(summary(r, "Volumes.java").slice(0, 5)).toEqual([
      [20, "jaxrs-client", "GET", "https://api.example-volumes.com/v1/volumes/{name}"],
      [25, "jaxrs-client", "DELETE", "https://api.example-volumes.com/v1/volumes/{name}"],
      [30, "jaxrs-client", "POST", "https://api.example-volumes.com/v1/volumes/create"],
      // same count, told apart by a literal's type
      [34, "jaxrs-client", "PUT", "https://api.example-volumes.com/v1/volumes/{name}/labels/archived"],
      [38, "jaxrs-client", "GET", "https://api.example-volumes.com/v1/volumes/{name}/hits"],
    ]);
    expect(at(r, "Volumes.java", 25).bodyEncoding).toBe("none");
    // a convenience overload delegating to the full one; a method set in a branch is unknown
    expect(summary(r, "Probes.java")[0]).toEqual([9, "java-http", "DYNAMIC", "https://api.example-probes.com/v1/health"]);
    // overloads differing only by the payload's type: the call is kept with what they agree on
    expect(at(r, "Payloads.java", 14)).toMatchObject({ method: "DYNAMIC", urlTemplate: "{url}", headers: ["x-client"], bodyEncoding: "raw", body: { type: "dynamic" } });
    expect(r.calls.filter((c) => c.location.file === "Payloads.java" && c.location.line === 14)).toHaveLength(1);
    expect(at(r, "Volumes.java", 30)).toMatchObject({ bodyEncoding: "json", body: { fromType: "Volume" } });
  });
});

describe("kotlin: requests started in several places (#73)", () => {
  it("reads Kotlin `when` and `if` starts, factories and overloads, and leaves more starts than are listed as one call", async () => {
    const r = await scanFixture("kotlin/request-starts");
    expect(r).toMatchSnapshot();
    expect(summary(r, "Relay.kt")).toEqual([
      [22, "async-http-client", "POST", "{url}"],
      [22, "async-http-client", "DELETE", "{url}"],
      [22, "async-http-client", "GET", "{url}"],
      [25, "unirest", "POST", "https://api.example-relay.com/v1/copies/{id}"],
      [25, "unirest", "GET", "https://api.example-relay.com/v1/items/{id}"],
      // a factory's two returns: the one with a literal host, its method unknown
      [27, "apache-httpclient", "DYNAMIC", "https://api.example-relay.com/ping"],
      [44, "async-http-client", "DYNAMIC", "{url}"],
    ]);
    // steps made on the variable after the `when` apply to every start
    expect(r.calls.filter((c) => c.location.file === "Relay.kt" && c.location.line === 22).every((c) => c.headers.includes("x-relay"))).toBe(true);
    expect(bodies(r, "Uploads.kt", 15)).toEqual([
      ["PUT", "json"],
      ["GET", "none"],
    ]);
    // by count and by name; an argument of unknown type fitting two overloads that send different requests: each
    expect(summary(r, "Pages.kt").slice(0, 3)).toEqual([
      [8, "okhttp", "GET", "https://api.example-pages.com/v1/pages"],
      [10, "okhttp", "DELETE", "https://api.example-pages.com/v1/pages?page=2"],
      [12, "okhttp", "DELETE", "https://api.example-pages.com/v1/archive?page=3"],
    ]);
    expect(summary(r, "Pages.kt").filter((c) => (c as unknown[])[0] === 14)).toEqual([
      [14, "okhttp", "GET", "https://api.example-pages.com/v1/notes/{value}"],
      [14, "okhttp", "DELETE", "https://api.example-pages.com/v1/notes/{value}"],
    ]);
  });
});

describe("jvm: what a client adds to every request (#73)", () => {
  it("reads target hosts, default headers, interceptors, filters, configured base URLs and credentials", async () => {
    const r = await scanFixture("java/request-factories");
    expect(summary(r, "Ledger.java").slice(1)).toEqual([
      [29, "apache-httpclient", "GET", "https://api.example-ledger.com/v2/balances"],
      [33, "apache-httpclient", "GET", "https://status.example-ledger.com:8443/health"],
    ]);
    expect(summary(r, "Notices.java")[0]).toEqual([29, "unirest", "GET", "https://api.example-notices.com/v1/notices"]);
    expect(parts(r, "Ledger.java", 29)).toEqual(["x-api-key:default", "x-tenant:interceptor"]);
    expect(at(r, "Ledger.java", 29)).toMatchObject({ authScheme: "apikey", headers: ["x-api-key", "x-tenant"] });
    expect(parts(r, "Notices.java", 29)).toEqual(["x-api-key:default"]);
    expect(at(r, "Notices.java", 33)).toMatchObject({ authScheme: "bearer", clientParts: [{ name: "authorization", from: "interceptor" }] });
    expect(at(r, "Notices.java", 37)).toMatchObject({ authScheme: "bearer", headers: ["authorization"] });
  });
});

describe("java: Lombok builders (#73)", () => {
  it("reads @Singular adders and copies made with toBuilder()", async () => {
    const r = await scanFixture("java/lombok");
    expect(at(r, "Carts.java", 27).body).toMatchObject({
      properties: { cart_id: { type: "string" }, items: { type: "array" }, labels: { properties: { channel: { enum: ["web"] } } } },
    });
    // the copy keeps the original's fields, the new value replacing the old one
    expect(at(r, "Carts.java", 33).body).toMatchObject({ properties: { cart_id: { type: "string" }, currency: { enum: ["EUR"] } } });
  });
});
