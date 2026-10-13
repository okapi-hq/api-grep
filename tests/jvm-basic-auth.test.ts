import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("jvm: OkHttp Credentials.basic as basic auth (#69)", () => {
  it("reads it on a request and in an interceptor, in Kotlin", async () => {
    const r = await scanFixture("kotlin/okhttp-auth");
    expect(r).toMatchSnapshot();
    expect(at(r, "Registry.kt", 17)).toMatchObject({ headers: ["authorization"], headerValues: { authorization: null }, authScheme: "basic" });
    expect(at(r, "Registry.kt", 28)).toMatchObject({ authScheme: "basic", clientParts: [{ where: "header", name: "authorization", from: "interceptor" }] });
  });

  it("reads it on a request and in an interceptor, in Java", async () => {
    const r = await scanFixture("java/okhttp-auth");
    expect(r).toMatchSnapshot();
    expect(at(r, "Registry.java", 25)).toMatchObject({ authScheme: "basic", clientParts: [{ where: "header", name: "authorization", from: "interceptor" }] });
    expect(at(r, "Registry.java", 33)).toMatchObject({ headers: ["authorization"], authScheme: "basic" });
  });
});
