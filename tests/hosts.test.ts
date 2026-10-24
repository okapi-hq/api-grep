import { describe, expect, it } from "vitest";
import { hostsLine } from "../src/report/diagnostics.js";
import { scanFixture } from "./fixture-helpers.js";

describe("host coverage", () => {
  it("compares the API hosts the code names with the calls' hosts", async () => {
    const r = await scanFixture("hosts");
    // stripe and openai are call hosts; acme-demo.supabase.co matches the call host {project}.supabase.co; the
    // telegram call is past the wrapper limit and the mailgun one goes through a client api-grep does not know
    expect(r.coverage?.hosts).toEqual({
      named: 5,
      explained: 3,
      byLanguage: [
        { language: "python", named: 3, explained: 2 },
        { language: "typescript", named: 2, explained: 1 },
      ],
      unexplained: [
        { host: "api.mailgun.net", files: 1, literals: 1, language: "python", first: { file: "notify.py", line: 24 } },
        { host: "api.telegram.org", files: 1, literals: 1, language: "typescript", first: { file: "relay.ts", line: 1 } },
      ],
    });
    expect(hostsLine(r.coverage!.hosts!)).toBe("hosts named in code: 5, explained by a call: 3; not explained: api.mailgun.net (1 file), api.telegram.org (1 file)");
  });

  it("counts only the files the scan reads", async () => {
    const r = await scanFixture("hosts", { languages: ["python"] });
    expect(r.coverage?.hosts).toMatchObject({ named: 3, explained: 2, unexplained: [{ host: "api.mailgun.net" }] });
  });
});
