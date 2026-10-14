import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** The client parts of a call by name, `optional` or `always`. */
const parts = (c: Call): Record<string, string> => Object.fromEntries((c.clientParts ?? []).map((p) => [p.name, p.optional ? "optional" : "always"]));

describe("jvm: headers an interceptor adds on some requests only (#69)", () => {
  it("marks them optional in Kotlin", async () => {
    const r = await scanFixture("kotlin/optional-headers");
    expect(r).toMatchSnapshot();
    // in a branch, or in both branches of an if / else
    expect(parts(at(r, "Atlas.kt", 89))).toEqual({ "user-agent": "always", accept: "optional", referer: "optional", "x-atlas-mode": "always", trace: "optional" });
    // the call sets the header itself
    expect(parts(at(r, "Atlas.kt", 92))).toMatchObject({ referer: "always" });
    // after an early return, after `?: return`
    expect(parts(at(r, "Atlas.kt", 96))).toEqual({ authorization: "optional", "x-atlas-session": "optional" });
    // a builder extension called in a branch, a `?.let` lambda
    expect(parts(at(r, "Atlas.kt", 98))).toEqual({ "x-atlas-locale": "optional", "x-device": "optional" });
  });

  it("marks them optional in Java (OkHttp, Spring and Apache interceptors)", async () => {
    const r = await scanFixture("java/optional-headers");
    expect(r).toMatchSnapshot();
    expect(parts(at(r, "Atlas.java", 68))).toEqual({ "user-agent": "always", accept: "optional", "x-atlas-mode": "always", authorization: "optional", "x-device": "optional" });
    expect(parts(at(r, "Atlas.java", 77))).toEqual({ "x-atlas-client": "always", "x-atlas-region": "optional" });
    expect(parts(at(r, "Atlas.java", 88))).toEqual({ "x-trace": "optional" });
  });
});
