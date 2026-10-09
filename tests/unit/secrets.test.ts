import { describe, expect, it } from "vitest";
import { isCredentialHeader, isCredentialKey, looksSecret, maskCredentialQuery, stripUserinfo, withoutCredentialLiterals } from "../../src/secrets.js";
import type { Shape } from "../../src/types.js";

const elapsedMs = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("looksSecret", () => {
  // built from parts so secret scanners do not take these fakes for real tokens
  const fake = (...parts: string[]): string => parts.join("");

  it("recognizes provider token shapes", () => {
    expect(looksSecret(fake("glpat", "-abcdefghij0123456789"))).toBe(true);
    expect(looksSecret(fake("https://hooks.slack.com/services/", "T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx"))).toBe(true);
    expect(looksSecret(fake("SG", ".abcdefghijklmnop.qrstuvwxyzABCDEF"))).toBe(true);
    expect(looksSecret("123456789:AAabcdefghijklmnopqrstuvwxyzABCDEFG")).toBe(true);
    expect(looksSecret(fake("npm", "_abcdefghijklmnopqrstuvwxyz0123456789"))).toBe(true);
    expect(looksSecret(fake("hf", "_abcdefghijklmnopqrstuvwxyzABCD"))).toBe(true);
    expect(looksSecret(fake("ya29", ".abcdefghijklmnopqrst"))).toBe(true);
  });

  it("recognizes credentials in a URL's userinfo", () => {
    expect(looksSecret("https://user:pass@api.example.com/x")).toBe(true);
    expect(looksSecret("postgres://admin:hunter2@db:5432/app")).toBe(true);
    expect(looksSecret("https://user@api.example.com/x")).toBe(false);
    expect(looksSecret("https://api.example.com:8443/a@b")).toBe(false);
  });

  it("leaves ordinary paths and URLs alone", () => {
    expect(looksSecret("/v1/customers/{id}")).toBe(false);
    expect(looksSecret("https://api.example.com/x")).toBe(false);
    expect(looksSecret("https://{env:API}/x")).toBe(false);
    expect(looksSecret("")).toBe(false);
  });

  it("runs in linear time on adversarial input", () => {
    expect(elapsedMs(() => looksSecret("ey-".repeat(30000)))).toBeLessThan(1000);
    expect(elapsedMs(() => looksSecret("a".repeat(200000)))).toBeLessThan(1000);
    expect(elapsedMs(() => looksSecret("http://a:".repeat(5000)))).toBeLessThan(1000);
  });
});

describe("isCredentialKey", () => {
  it("matches credential names written in one lowercase word", () => {
    for (const k of ["authtoken", "accesstoken", "apitoken", "clientsecret", "secretkey", "apikey", "newpassword"]) expect(isCredentialKey(k), k).toBe(true);
  });

  it("matches names that hold credentials", () => {
    for (const k of ["password", "client_secret", "apiKey", "api_key", "accessToken", "key", "x-api-key", "privateKey"]) expect(isCredentialKey(k), k).toBe(true);
  });

  it("ignores ordinary names", () => {
    for (const k of ["keyword", "name", "email", "keyboard", "tokenizer"]) expect(isCredentialKey(k), k).toBe(false);
  });

  it("ignores lowercase words that merely end in key", () => {
    for (const k of ["monkey", "turkey", "hockey"]) expect(isCredentialKey(k), k).toBe(false);
  });
});

describe("isCredentialHeader", () => {
  it("matches auth, key and session headers in any case", () => {
    for (const h of ["Authorization", "Proxy-Authorization", "X-Api-Key", "idempotency-key", "cookie", "Set-Cookie", "X-Auth-Token"]) expect(isCredentialHeader(h), h).toBe(true);
  });

  it("ignores content negotiation and versioning headers", () => {
    for (const h of ["content-type", "x-api-version", "accept", "user-agent"]) expect(isCredentialHeader(h), h).toBe(false);
  });
});

describe("stripUserinfo", () => {
  it("drops user and password from an absolute URL", () => {
    expect(stripUserinfo("https://u:p@h.com/x")).toBe("https://h.com/x");
    expect(stripUserinfo("postgres://admin@db:5432/app")).toBe("postgres://db:5432/app");
    expect(stripUserinfo("https://admin:p@ssw0rd@api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("leaves an @ in the path or query alone", () => {
    expect(stripUserinfo("https://h.com/a@b")).toBe("https://h.com/a@b");
    expect(stripUserinfo("https://h.com/x?email=a@b.com")).toBe("https://h.com/x?email=a@b.com");
    expect(stripUserinfo("/users/@me")).toBe("/users/@me");
  });
});

describe("maskCredentialQuery", () => {
  it("masks credential values and keeps the others", () => {
    expect(maskCredentialQuery("?api_key=abc&page=2")).toBe("?api_key=<redacted>&page=2");
    expect(maskCredentialQuery("https://h.com/x?page=2&access_token=abc#frag")).toBe("https://h.com/x?page=2&access_token=<redacted>#frag");
  });

  it("keeps placeholders and empty values", () => {
    expect(maskCredentialQuery("?api_key={key}&token={env:TOKEN}")).toBe("?api_key={key}&token={env:TOKEN}");
    expect(maskCredentialQuery("?api_key=&page=2")).toBe("?api_key=&page=2");
  });

  it("returns a URL without a query unchanged", () => {
    expect(maskCredentialQuery("https://h.com/api_key=abc")).toBe("https://h.com/api_key=abc");
  });
});

describe("withoutCredentialLiterals under a credential property", () => {
  const pwd: Shape = { type: "string", enum: ["hunter2"] };
  const role: Shape = { type: "string", enum: ["admin"] };

  it("drops every literal, inside arrays and objects too", () => {
    const shape: Shape = {
      type: "object",
      required: [],
      properties: { token: { type: "array", items: pwd }, api_key: { type: "object", required: [], properties: { value: pwd, role } } },
    };
    expect(withoutCredentialLiterals(shape)).toEqual({
      type: "object",
      required: [],
      properties: { token: { type: "array", items: { type: "string" } }, api_key: { type: "object", required: [], properties: { value: { type: "string" }, role: { type: "string" } } } },
    });
  });
});

describe("withoutCredentialLiterals", () => {
  const pwd: Shape = { type: "string", enum: ["hunter2"] };
  const role: Shape = { type: "string", enum: ["admin"] };

  it("drops enums of credential properties at any depth", () => {
    const shape: Shape = {
      type: "object",
      required: ["password"],
      properties: {
        password: pwd,
        role,
        users: { type: "array", items: { type: "object", required: [], properties: { apiKey: pwd, role } } },
        auth: { type: "union", anyOf: [{ type: "object", required: [], properties: { client_secret: pwd } }, { type: "null" }] },
      },
    };
    expect(withoutCredentialLiterals(shape)).toEqual({
      type: "object",
      required: ["password"],
      properties: {
        password: { type: "string" },
        role,
        users: { type: "array", items: { type: "object", required: [], properties: { apiKey: { type: "string" }, role } } },
        auth: { type: "union", anyOf: [{ type: "object", required: [], properties: { client_secret: { type: "string" } } }, { type: "null" }] },
      },
    });
  });

  it("drops literals of every branch of a credential union", () => {
    const shape: Shape = { type: "object", required: [], properties: { token: { type: "union", anyOf: [pwd, { type: "number", enum: [42] }] } } };
    expect(withoutCredentialLiterals(shape)).toEqual({ type: "object", required: [], properties: { token: { type: "union", anyOf: [{ type: "string" }, { type: "number" }] } } });
  });

  it("keeps types, hints and non-object shapes", () => {
    const shape: Shape = { type: "object", required: [], properties: { password: { type: "string", enum: ["x"], hint: "pwd", fromType: "string" } } };
    expect(withoutCredentialLiterals(shape)).toEqual({ type: "object", required: [], properties: { password: { type: "string", hint: "pwd", fromType: "string" } } });
    expect(withoutCredentialLiterals(role)).toEqual(role);
    expect(withoutCredentialLiterals(undefined)).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const shape: Shape = { type: "object", required: [], properties: { password: { type: "string", enum: ["x"] } } };
    withoutCredentialLiterals(shape);
    expect(shape).toEqual({ type: "object", required: [], properties: { password: { type: "string", enum: ["x"] } } });
  });
});
