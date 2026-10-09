import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { supportMarkdown } from "../../scripts/support-table.js";

describe("docs/sdk-support.md", () => {
  it("is up to date with the registries and providers.json (run `pnpm gen:support`)", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "sdk-support.md");
    expect(readFileSync(file, "utf8")).toBe(supportMarkdown());
  });
});
