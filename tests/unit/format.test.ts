import { describe, expect, it } from "vitest";
import { braceParts, printfParts } from "../../src/lang/ir/format.js";
import { partsToTemplate } from "../../src/resolve/parts.js";
import type { Part } from "../../src/types.js";

const lit = (text: string): Part[] => [{ kind: "static", text }];
const dyn = (name: string): Part[] => [{ kind: "dynamic", name, origin: "param" }];

describe("format strings", () => {
  it("fills printf conversions in order, by name, and keeps %%", () => {
    expect(partsToTemplate(printfParts("%s/users/%d?q=100%%", { positional: [lit("https://api.x.com"), dyn("id")], named: new Map() }))).toBe("https://api.x.com/users/{id}?q=100%");
    expect(partsToTemplate(printfParts("/teams/%(team)s/%-5s", { positional: [dyn("member")], named: new Map([["team", dyn("team")]]) }))).toBe("/teams/{team}/{member}");
  });

  it("fills brace fields by position, index and name, and unescapes doubled braces", () => {
    const args = { positional: [lit("https://api.x.com"), dyn("id")], named: new Map([["kind", lit("orders")]]) };
    expect(partsToTemplate(braceParts("{}/v1/{kind}/{}", args))).toBe("https://api.x.com/v1/orders/{id}");
    expect(partsToTemplate(braceParts("{0}/{{literal}}/{1!r:>4}", args))).toBe("https://api.x.com/{literal}/{id}");
  });

  it("keeps a placeholder when a value is missing", () => {
    expect(partsToTemplate(printfParts("/a/%s/%s", { positional: [lit("x")], named: new Map() }))).toBe("/a/x/{arg2}");
  });
});
