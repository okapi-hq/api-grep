import { describe, expect, it } from "vitest";
import { canonicalPath, firstPlaceholder, normalizePath, placeholderNames } from "../../src/normalize/path.js";

describe("placeholderNames", () => {
  it("lists placeholder names in order", () => {
    expect(placeholderNames("/v1/{org}/repos/{repo}/{env:API_VERSION}")).toEqual(["org", "repo", "env:API_VERSION"]);
    expect(placeholderNames("/v1/plain")).toEqual([]);
    expect(placeholderNames("/{}/{a")).toEqual([]);
  });

  it("gives the same answer on repeated calls", () => {
    expect(placeholderNames("/{a}/{b}")).toEqual(placeholderNames("/{a}/{b}"));
  });
});

describe("firstPlaceholder", () => {
  it("returns the first placeholder name or undefined", () => {
    expect(firstPlaceholder("https://{host}/v1/{id}")).toBe("host");
    expect(firstPlaceholder("/v1/users")).toBeUndefined();
  });

  it("keeps no state between calls", () => {
    const text = "/x/{id}/y/{other}";
    expect(firstPlaceholder(text)).toBe("id");
    expect(firstPlaceholder(text)).toBe("id");
    expect(placeholderNames(text)).toEqual(["id", "other"]);
    expect(firstPlaceholder(text)).toBe("id");
  });
});

describe("canonicalPath", () => {
  it("collapses slashes, drops the trailing one and shortens env placeholders", () => {
    expect(canonicalPath("//a//{env:X}/")).toBe("/a/{X}");
    expect(canonicalPath("v1/{env:API_VERSION}/users/{id}")).toBe("/v1/{API_VERSION}/users/{id}");
  });

  it("keeps the root path", () => {
    expect(canonicalPath("")).toBe("/");
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("///")).toBe("/");
  });

  it("is idempotent", () => {
    const once = canonicalPath("//a//{env:X}/b/");
    expect(canonicalPath(once)).toBe(once);
    expect(normalizePath(once)).toBe(once);
  });
});
