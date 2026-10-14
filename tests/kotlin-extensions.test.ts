import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("Kotlin: calls made in extension functions of a client type (#86)", () => {
  it("reads `this` and bare calls on the receiver, and follows the callers' clients", async () => {
    const r = await scanFixture("kotlin/extensions");
    expect(r).toMatchSnapshot();
    // `this.deleteObject(...)` and a bare `headBucket(...)` in `fun S3Client.x()`
    expect(at(r, "Storage.kt", 10)).toMatchObject({ client: "sdk", provider: "aws", method: "DELETE", pathTemplate: "/{Bucket}/{Key}" });
    expect(at(r, "Storage.kt", 14)).toMatchObject({ client: "sdk", method: "HEAD" });
    // a call of another extension of the receiver's type, bare
    expect(at(r, "Storage.kt", 22)).toMatchObject({ method: "DELETE", via: "wrapper:delete" });
    // `s3.delete(...)` on a client with its own endpoint
    expect(at(r, "Gallery.kt", 14)).toMatchObject({ urlTemplate: "https://storage.gallery-example.com/{Bucket}/originals/{photo}", via: "wrapper:delete" });
    // a bare `newCall(...)` on the receiver: the caller's client and its interceptor
    expect(at(r, "Catalog.kt", 46)).toMatchObject({ urlTemplate: "https://api.catalog-example.com/v1/items?page=2", headers: ["x-catalog-key"], clientParts: [{ where: "header", name: "x-catalog-key", from: "interceptor" }] });
    expect(at(r, "Catalog.kt", 48)).toMatchObject({ headers: ["accept", "x-catalog-key"] });
    // Ktor's `get(url)`, imported from the client's library, called bare on the receiver
    expect(at(r, "Catalog.kt", 23)).toMatchObject({ client: "ktor", query: ["q"] });
    // the extension of the client's type, not the one of the same name on OkHttp
    expect(at(r, "Catalog.kt", 50)).toMatchObject({ client: "ktor", urlTemplate: "https://status.catalog-example.com/v1/health" });
    expect(r.calls.filter((c) => c.location.file === "Catalog.kt" && c.location.line === 50)).toHaveLength(1);
    // `with(cache) { get(...) }`: the lambda's receiver is not the client
    expect(r.calls.some((c) => c.location.file === "Catalog.kt" && c.location.line === 35)).toBe(false);
    // `withContext { head(url) }`: a lambda without a receiver keeps the extension's
    expect(at(r, "Catalog.kt", 38)).toMatchObject({ client: "ktor", method: "HEAD" });
  });
});
