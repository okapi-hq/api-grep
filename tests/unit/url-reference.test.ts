import { describe, expect, it } from "vitest";
import { partsToTemplate } from "../../src/resolve/parts.js";
import { removeDotSegments, resolveReference } from "../../src/resolve/url-reference.js";
import type { Part } from "../../src/types.js";

const s = (text: string): Part => ({ kind: "static", text });
const resolve = (base: Part[], ref: string): string => partsToTemplate(resolveReference(base, [s(ref)]));

describe("resolveReference (RFC 3986, as Retrofit resolves an endpoint against its base URL)", () => {
  const base = [s("https://api.example.com/v2/")];

  it("appends a relative path to the base's directory and replaces it with an absolute one", () => {
    expect(resolve(base, "items/{id}")).toBe("https://api.example.com/v2/items/{id}");
    expect(resolve(base, "/health")).toBe("https://api.example.com/health");
    expect(resolve([s("https://api.example.com/v2/users")], "items")).toBe("https://api.example.com/v2/items");
    expect(resolve([s("https://api.example.com")], "items")).toBe("https://api.example.com/items");
  });

  it("reads dot segments", () => {
    expect(resolve(base, ".")).toBe("https://api.example.com/v2/");
    expect(resolve(base, "../v3/items")).toBe("https://api.example.com/v3/items");
    expect(removeDotSegments("/a/b/../c/./d")).toBe("/a/c/d");
  });

  it("drops the base's query string for a reference with a path, keeps an absolute reference as it is", () => {
    expect(resolve([s("https://api.example.com/?key=abc")], "data/weather")).toBe("https://api.example.com/data/weather");
    expect(resolve([s("https://api.example.com/v1/?key=abc")], "?page=2")).toBe("https://api.example.com/v1/?page=2");
    expect(resolve(base, "https://cdn.example.com/a.json")).toBe("https://cdn.example.com/a.json");
    expect(resolve(base, "")).toBe("https://api.example.com/v2/");
  });

  it("keeps env and dynamic parts: an env var's default path is extended or replaced, a dynamic reference wins", () => {
    const env: Part[] = [{ kind: "env", name: "API_URL", fallback: "https://api.example.com/v2/" }];
    const items = resolveReference(env, [s("items")]);
    expect(items[0]).toEqual({ kind: "env", name: "API_URL", fallback: "https://api.example.com" });
    expect(partsToTemplate(items)).toBe("{env:API_URL}/v2/items");
    expect(partsToTemplate(resolveReference(env, [s("/health")]))).toBe("{env:API_URL}/health");
    const host: Part[] = [s("https://"), { kind: "dynamic", name: "host", origin: "param" }, s("/v1/")];
    expect(partsToTemplate(resolveReference(host, [s("/x")]))).toBe("https://{host}/x");
    expect(partsToTemplate(resolveReference(host, [s("x")]))).toBe("https://{host}/v1/x");
    expect(resolveReference(base, [{ kind: "dynamic", name: "url", origin: "param" }])).toEqual([{ kind: "dynamic", name: "url", origin: "param" }]);
  });
});
