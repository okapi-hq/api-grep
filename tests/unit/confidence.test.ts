import { describe, expect, it } from "vitest";
import { score, type Evidence } from "../../src/confidence.js";

const base: Evidence = { sdkHit: false, hostKind: "literal", envHinted: false, pathDynamicNamed: true, bodySource: "none", viaWrapper: false, specMatched: false, optionsOpaque: false };

describe("score", () => {
  it("follows the additive rules and clamps", () => {
    expect(score(base)).toBe(0.4);
    expect(score({ ...base, bodySource: "literal" })).toBe(0.6);
    expect(score({ ...base, sdkHit: true, bodySource: "type", specMatched: true })).toBe(1);
    expect(score({ ...base, hostKind: "unknown", bodySource: "unknown" })).toBe(0);
  });

  it("caps unknown and relative hosts at 0.4", () => {
    expect(score({ ...base, hostKind: "relative", bodySource: "literal" })).toBe(0.4);
    expect(score({ ...base, hostKind: "unknown", bodySource: "literal", specMatched: true })).toBe(0.4);
  });
});
