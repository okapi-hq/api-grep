import { describe, expect, it } from "vitest";
import { coverageWarnings } from "../src/report/diagnostics.js";
import { scanFixture } from "./fixture-helpers.js";

describe("sdk coverage", () => {
  it("gives each declared or imported API SDK a status", async () => {
    const r = await scanFixture("coverage");
    const byPkg = Object.fromEntries(r.coverage!.sdks.map((s) => [s.package, s]));
    expect(byPkg["twilio"]).toMatchObject({ provider: "twilio", supported: true, imported: true, importSites: 1, calls: 1, status: "ok" });
    expect(byPkg["@notionhq/client"]).toMatchObject({ provider: "notion", supported: false, imported: true, calls: 0, status: "unsupported" });
    // the `import type` in types.ts is not an import site
    expect(byPkg["stripe"]).toMatchObject({ supported: true, importSites: 1, calls: 0, status: "imported-no-calls" });
    expect(byPkg["openai"]).toMatchObject({ declared: true, imported: false, importSites: 0, status: "declared-not-imported" });
    expect(Object.keys(byPkg)).toHaveLength(4);
  });

  it("warns once per SDK whose calls are missing", async () => {
    const r = await scanFixture("coverage");
    expect(coverageWarnings(r.coverage!)).toEqual([
      "@notionhq/client imported in 1 file, no registry: its calls are not listed",
      "stripe imported in 1 file, but no call was found (used through a wrapper?)",
    ]);
  });

  it("attributes calls to the package actually imported", async () => {
    const r = await scanFixture("sdk/supabase");
    const byPkg = Object.fromEntries(r.coverage!.sdks.map((s) => [s.package, s]));
    // context.ts only has `import type { SupabaseClient }`: not an import site, but its calls still count
    expect(byPkg["@supabase/supabase-js"]).toMatchObject({ status: "ok", importSites: 1, calls: 14 });
    expect(byPkg["@supabase/ssr"]).toMatchObject({ status: "ok", calls: 2 });
  });
});
