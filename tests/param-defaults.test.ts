import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** A parameter's values: the literals its callers pass and its default when some caller leaves it out (#39). */
const maxTokens = (c: Call): unknown => (c.body as { properties: Record<string, unknown> }).properties.max_tokens;
const header = (c: Call): { value: string | null | undefined; alternatives?: string[] } => ({
  value: c.headerValues["x-api-version"],
  ...(c.headerAlternatives?.["x-api-version"] ? { alternatives: c.headerAlternatives["x-api-version"] } : {}),
});

const defaultOnly = {
  model: { values: ["gpt-4o-mini"], dynamic: false, sources: [{ value: "gpt-4o-mini", from: "default" }], from: "body" },
  maxTokens: { type: "integer", enum: [1024] },
};
const withCaller = {
  model: { values: ["gpt-4o-mini", "o3"], dynamic: false, sources: [{ value: "gpt-4o-mini", from: "default" }], from: "body" },
  maxTokens: { type: "integer", enum: [1024, 4096] },
};

describe("parameter values: python", () => {
  it("reads the default, the callers' literals, and marks unread arguments dynamic", async () => {
    const r = await scanFixture("python/resolve/param-defaults");
    expect(r).toMatchSnapshot();
    expect({ model: at(r, "assistant.py", 7).model, maxTokens: maxTokens(at(r, "assistant.py", 7)) }).toEqual(defaultOnly);
    expect({ model: at(r, "assistant.py", 11).model, maxTokens: maxTokens(at(r, "assistant.py", 11)) }).toEqual(withCaller);
    expect(at(r, "assistant.py", 15).model).toEqual({ values: ["gpt-4o-mini"], dynamic: true, hint: "model", sources: [{ value: "gpt-4o-mini", from: "default" }], from: "body" });
    expect(maxTokens(at(r, "assistant.py", 15))).toEqual({ type: "union", anyOf: [{ type: "integer", enum: [1024] }, { type: "dynamic", origin: "param", hint: "max_tokens" }] });
    // a class attribute behind `model or self.default_model` joins the callers' values
    expect(at(r, "assistant.py", 32).model?.values).toEqual(["gpt-4.1-nano", "gpt-4.1"]);
    expect(header(at(r, "forecast.py", 7))).toEqual({ value: "2024-06-01" });
    expect(header(at(r, "forecast.py", 11))).toEqual({ value: "2024-06-01", alternatives: ["2024-06-01", "2025-01-15"] });
    expect(header(at(r, "forecast.py", 15))).toEqual({ value: null, alternatives: ["2024-06-01"] });
  });
});

describe("parameter values: php", () => {
  it("reads defaults and callers' literals of methods called on $this", async () => {
    const r = await scanFixture("php/resolve/param-defaults");
    expect(r).toMatchSnapshot();
    expect({ model: at(r, "Assistant.php", 13).model, maxTokens: maxTokens(at(r, "Assistant.php", 13)) }).toEqual(defaultOnly);
    expect({ model: at(r, "Assistant.php", 18).model, maxTokens: maxTokens(at(r, "Assistant.php", 18)) }).toEqual(withCaller);
    expect(at(r, "Assistant.php", 23).model).toEqual({ values: ["gpt-4o-mini"], dynamic: true, hint: "model", sources: [{ value: "gpt-4o-mini", from: "default" }], from: "body" });
    expect(header(at(r, "Assistant.php", 28))).toEqual({ value: null, alternatives: ["2024-06-01", "2025-01-15"] });
  });
});

describe("parameter values: typescript", () => {
  it("reads initializers through the checker and callers through references", async () => {
    const r = await scanFixture("resolve/param-defaults");
    expect(r).toMatchSnapshot();
    expect({ model: at(r, "assistant.ts", 6).model, maxTokens: maxTokens(at(r, "assistant.ts", 6)) }).toEqual(defaultOnly);
    expect({ model: at(r, "assistant.ts", 10).model, maxTokens: maxTokens(at(r, "assistant.ts", 10)) }).toEqual(withCaller);
    expect(at(r, "assistant.ts", 14).model).toEqual({ values: ["gpt-4o-mini"], dynamic: true, hint: "model", sources: [{ value: "gpt-4o-mini", from: "default" }], from: "body" });
    expect(maxTokens(at(r, "assistant.ts", 14))).toEqual({ type: "union", anyOf: [{ type: "integer", enum: [1024] }, { type: "number", hint: "maxTokens" }] });
    expect(at(r, "assistant.ts", 31).model?.values).toEqual(["gpt-4.1-nano", "gpt-4.1"]);
    expect(header(at(r, "forecast.ts", 4))).toEqual({ value: "2024-06-01" });
    expect(header(at(r, "forecast.ts", 8))).toEqual({ value: "2024-06-01", alternatives: ["2024-06-01", "2025-01-15"] });
    expect(header(at(r, "forecast.ts", 12))).toEqual({ value: null, alternatives: ["2024-06-01"] });
    // at a caller, the wrapper expansion already substitutes the argument: one value per call site
    expect(header(at(r, "forecast.ts", 17))).toEqual({ value: "2025-01-15" });
    expect(header(at(r, "forecast.ts", 22))).toEqual({ value: null });
  });
});
