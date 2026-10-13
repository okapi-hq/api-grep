import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("jvm: header and query names from constants (#61)", () => {
  it("reads Kotlin const val members and @Headers lines with templates", async () => {
    const r = await scanFixture("kotlin/const-names");
    expect(r).toMatchSnapshot();
    expect(at(r, "Shelf.kt", 17)).toMatchObject({
      query: ["page"],
      headers: ["accept", "x-client", "x-save-data", "x-trace-id"],
      headerValues: { accept: "application/json", "x-client": "shelf-android", "x-save-data": null, "x-trace-id": null },
      authScheme: "none",
    });
    // a value known at run time only keeps its name and scheme
    expect(at(r, "Shelf.kt", 22)).toMatchObject({ headers: ["authorization"], headerValues: { authorization: null }, authScheme: "bearer" });
    // a name the scan cannot read leaves the headers unknown rather than dropping the line
    expect(at(r, "Shelf.kt", 27)).toMatchObject({ headers: [], authScheme: "unknown" });
    expect(at(r, "Shelf.kt", 41)).toMatchObject({ headers: ["x-save-data", "x-trace-id"], headerValues: { "x-save-data": "1" }, authScheme: "none" });
    // not the parameter's name (`tenant`)
    expect(at(r, "Shelf.kt", 47)).toMatchObject({ client: "feign", query: ["page"], headers: ["x-tenant"] });
  });

  it("reads Java static final members, static imports and concatenated @Headers lines", async () => {
    const r = await scanFixture("java/const-names");
    expect(r).toMatchSnapshot();
    expect(at(r, "Ledger.java", 22)).toMatchObject({
      query: ["page"],
      headers: ["accept", "x-client", "x-trace-id"],
      headerValues: { accept: "application/json", "x-client": "ledger-android" },
      authScheme: "none",
    });
    expect(at(r, "Ledger.java", 29)).toMatchObject({ client: "feign", query: ["page"], headers: ["x-tenant"] });
    expect(at(r, "Ledger.java", 44)).toMatchObject({ headers: ["x-trace-id", "x-tenant"], headerValues: { "x-tenant": "main" }, authScheme: "none" });
  });
});
