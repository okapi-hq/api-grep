import { describe, expect, it } from "vitest";
import { partsToUrlShape } from "../../src/resolve/url.js";
import type { Part } from "../../src/types.js";

const s = (text: string, viaConst = false): Part => ({ kind: "static", text, viaConst });
const d = (name: string): Part => ({ kind: "dynamic", name, origin: "param" });
const env = (name: string): Part => ({ kind: "env", name });

describe("partsToUrlShape", () => {
  it("parses absolute literal URLs with query", () => {
    const u = partsToUrlShape([s("https://API.Stripe.com/v1/customers?limit=10&starting_after="), d("cursor")]);
    expect(u).toMatchObject({ hostKind: "literal", host: "api.stripe.com", pathTemplate: "/v1/customers", query: ["limit", "starting_after"] });
    expect(u.dynamic).toEqual([{ where: "query", name: "starting_after", origin: "param" }]);
  });

  it("marks const hosts and keeps path placeholders", () => {
    const u = partsToUrlShape([s("https://api.x.com", true), s("/v1/users/"), d("id"), s("/posts")]);
    expect(u).toMatchObject({ hostKind: "const", pathTemplate: "/v1/users/{id}/posts" });
    expect(u.dynamic).toEqual([{ where: "path", name: "id", origin: "param" }]);
  });

  it("uses env hints for env hosts", () => {
    const u = partsToUrlShape([env("API_URL"), s("/things")], { envHints: { API_URL: "https://api.example.com/" } });
    expect(u).toMatchObject({ hostKind: "env", envName: "API_URL", host: "api.example.com", pathTemplate: "/things" });
    const noHint = partsToUrlShape([env("API_URL"), s("things")]);
    expect(noHint).toMatchObject({ hostKind: "env", host: undefined, pathTemplate: "/things" });
  });

  it("classifies relative and unknown hosts", () => {
    expect(partsToUrlShape([s("/api/users")])).toMatchObject({ hostKind: "relative", pathTemplate: "/api/users" });
    const u = partsToUrlShape([d("base"), s("/v1")]);
    expect(u).toMatchObject({ hostKind: "unknown", pathTemplate: "/v1" });
    expect(u.dynamic).toEqual([{ where: "host", name: "base", origin: "param" }]);
  });

  it("splits a placeholder glued to a literal host into the path", () => {
    const u = partsToUrlShape([s("https://api.hubapi.com"), d("path")]);
    expect(u).toMatchObject({ hostKind: "literal", host: "api.hubapi.com", pathTemplate: "/{path}" });
  });

  it("keeps templated hosts such as regional AWS endpoints", () => {
    const u = partsToUrlShape([s("https://s3."), d("region"), s(".amazonaws.com/bucket")]);
    expect(u).toMatchObject({ hostKind: "unknown", host: "s3.{region}.amazonaws.com", pathTemplate: "/bucket" });
  });

  it("normalizes double slashes, trailing slash and fragments", () => {
    expect(partsToUrlShape([s("https://a.com//v1/x/#frag")]).pathTemplate).toBe("/v1/x");
  });
});
