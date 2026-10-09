import { describe, expect, it } from "vitest";
import { printable } from "../../src/report/printable.js";

describe("printable", () => {
  it("escapes C0 controls, DEL and C1 controls", () => {
    expect(printable("a\nb")).toBe("a\\u000ab");
    expect(printable("a\r\tb")).toBe("a\\u000d\\u0009b");
    expect(printable("\u001b[31mred")).toBe("\\u001b[31mred");
    expect(printable("ding\u0007")).toBe("ding\\u0007");
    expect(printable("\u0000\u007f")).toBe("\\u0000\\u007f");
    expect(printable("\u009b2J")).toBe("\\u009b2J");
  });

  it("escapes bidirectional overrides and marks", () => {
    expect(printable("admin\u202e txt")).toBe("admin\\u202e txt");
    expect(printable("\u2066x\u2069")).toBe("\\u2066x\\u2069");
    expect(printable("\u200e\u200f\u061c")).toBe("\\u200e\\u200f\\u061c");
  });

  it("leaves printable text unchanged", () => {
    for (const s of ["", "https://api.example.com/v1/x?q=1", "café", "日本語", "it's \"quoted\" \\ back", "emoji 🎉"]) expect(printable(s)).toBe(s);
  });

  it("always returns a single line", () => {
    expect(printable("one\ntwo\r\nthree\v\f")).not.toMatch(/[\r\n\v\f]/);
  });
});
