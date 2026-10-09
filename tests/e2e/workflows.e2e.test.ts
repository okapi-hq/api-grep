import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cli, git, removeTempDirs, scanJson, tempRepo } from "./helpers.js";

afterAll(removeTempDirs);

describe("--changed-since", () => {
  it("scans changed and untracked files plus their direct importers", () => {
    const repo = tempRepo({
      "lib.ts": `export const base = "https://api.github.com";\nexport const meta = () => fetch(\`\${base}/meta\`);\n`,
      "consumer.ts": `import { base } from "./lib";\nexport const user = () => fetch(\`\${base}/user\`);\n`,
      "other.ts": `export const other = () => fetch("https://api.stripe.com/v1/balance");\n`,
    });
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    writeFileSync(path.join(repo, "lib.ts"), `export const base = "https://api.github.com";\nexport const meta = () => fetch(\`\${base}/rate_limit\`);\n`);
    writeFileSync(path.join(repo, "new.ts"), `export const fresh = () => fetch("https://api.linear.app/graphql", { method: "POST" });\n`);
    const { run, report } = scanJson(repo, ["--changed-since", "HEAD"]);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => `${c.location.file} ${c.pathTemplate}`).sort()).toEqual(["consumer.ts /user", "lib.ts /rate_limit", "new.ts /graphql"]);
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.coverage).toBeUndefined();
  });

  it("takes a range, scans a subdirectory and leaves unchanged unreadable files out", () => {
    const deep = `export const x = ${"(".repeat(20_000)}1${")".repeat(20_000)};\n`;
    const repo = tempRepo({ "pkg/a.ts": `export const a = () => fetch("https://api.github.com/meta");\n`, "pkg/deep.ts": deep, "other/b.ts": `export const b = 1;\n` });
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "one");
    writeFileSync(path.join(repo, "pkg", "a.ts"), `export const a = () => fetch("https://api.github.com/rate_limit");\n`);
    git(repo, "commit", "-q", "-am", "two");
    writeFileSync(path.join(repo, "pkg", "new.ts"), `export const n = () => fetch("https://api.stripe.com/v1/balance");\n`);
    const { run, report } = scanJson(path.join(repo, "pkg"), ["--changed-since", "HEAD~1...HEAD"]);
    expect(run.status).toBe(0);
    expect(report.calls.map((c) => `${c.location.file} ${c.pathTemplate}`).sort()).toEqual(["a.ts /rate_limit", "new.ts /v1/balance"]);
    expect(report.diagnostics?.skipped).toEqual([]);
  });

  it("fails on a ref that names no commit", () => {
    const repo = tempRepo({ "a.ts": `export const a = 1;\n` });
    git(repo, "init", "-q");
    const r = cli(["scan", repo, "--changed-since", "no-such-branch"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown git ref: no-such-branch");
  });
});

describe("--specs --validate", () => {
  it("names the operation and reports where the body departs from the spec", () => {
    const repo = tempRepo({
      "pay.ts": [
        `export const pay = () =>`,
        `  fetch("https://api.stripe.com/v1/payment_intents", {`,
        `    method: "POST",`,
        `    body: JSON.stringify({ amount: "12", currency: "gbp", descriptin: "typo" }),`,
        `  });`,
      ].join("\n"),
    });
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["amount", "currency"],
      properties: { amount: { type: "integer" }, currency: { type: "string", enum: ["usd", "eur"] }, description: { type: "string", nullable: true } },
    };
    const spec = {
      openapi: "3.0.0",
      info: { title: "stripe", version: "1" },
      servers: [{ url: "https://api.stripe.com/" }],
      paths: { "/v1/payment_intents": { post: { operationId: "PostPaymentIntents", requestBody: { content: { "application/json": { schema } } }, responses: {} } } },
    };
    const specs = tempRepo({ "elsewhere/stripe.json": JSON.stringify(spec) });
    writeFileSync(path.join(repo, "stripe.json"), JSON.stringify(spec));
    const findings = (specsDir: string): string[] => {
      const call = scanJson(repo, ["--specs", specsDir, "--validate"]).report.calls[0]!;
      expect(call.operationId).toBe("PostPaymentIntents");
      return call.findings.map((f) => `${f.rule}:${f.property}`).sort();
    };
    expect(findings(repo)).toEqual(["enum-mismatch:currency", "type-mismatch:amount", "unknown-property:descriptin"]);
    if (process.platform === "win32") return;
    // a spec linked from another checkout (an APIs-guru clone) is read like a copy
    const linked = tempRepo({});
    symlinkSync(path.join(specs, "elsewhere", "stripe.json"), path.join(linked, "stripe.json"));
    expect(findings(linked)).toHaveLength(3);
  });
});
