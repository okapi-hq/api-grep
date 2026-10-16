import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("functions the code passes around (#3, #4)", () => {
  it("resolves a package's own path aliases, from its tsconfig or the one its solution config references", async () => {
    const r = await scanFixture("nested-alias", { exclude: [], examples: 0 });
    expect(at(r, "web/src/pages/cart.ts", 4)).toMatchObject({ host: "api.shopfront-demo.io", pathTemplate: "/v1/cart", via: "wrapper:apiFetch" });
    expect(at(r, "admin/src/pages/users.ts", 4)).toMatchObject({ host: "admin.shopfront-demo.io", method: "DELETE", pathTemplate: "/api/users/{id}" });
    expect(r.diagnostics?.unfollowed).toEqual([]);
  });

  it("follows a fetch passed by the callers, and leaves a call unfollowed when they pass different functions", async () => {
    const r = await scanFixture("negatives/function-values", { examples: 0 });
    expect(r.calls).toEqual([]);
    expect(r.diagnostics?.unfollowed).toEqual([{ file: "local-fetchers.ts", line: 5, reason: "injected-fetch", expr: "fetchPage" }]);
    const passed = await scanFixture("wrappers/passed-functions", { examples: 0 });
    expect(at(passed, "callers.ts", 7)).toMatchObject({ client: "fetch", host: "status.uptimer-demo.io", pathTemplate: "/v1/health" });
    expect(at(passed, "callers.ts", 36)).toMatchObject({ client: "fetch", host: "jobs.pollster-demo.io", via: "wrapper:Poller.poll" });
  });
});
