import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Report } from "../../src/report/schema.js";
import { cli, removeTempDirs, tempRepo } from "./helpers.js";

afterAll(removeTempDirs);

/** A project whose types would change with packages installed above it. */
const PROJECT: Record<string, string> = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
  "src/signup.ts": [
    `import { makeId } from "idgen";`,
    `export const signUp = (email: string) =>`,
    `  fetch("https://api.example.com/v1/users", { method: "POST", body: JSON.stringify({ email, password: makeId() }) });`,
    `export const invite = (input: InviteInput) =>`,
    `  fetch("https://api.example.com/v1/invites", { method: "POST", body: JSON.stringify(input) });`,
  ].join("\n"),
};

/** What a checkout under a home directory can have above it: a stray `node_modules` with a package and global types. */
const PACKAGES: Record<string, string> = {
  "node_modules/idgen/package.json": `{ "name": "idgen", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/idgen/index.d.ts": `export declare function makeId(): string;`,
  "node_modules/@types/invites/index.d.ts": `interface InviteInput { email: string; role: "admin" | "member" }`,
};

const under = (dir: string, files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).map(([p, text]) => [`${dir}/${p}`, text]));

/** The report of `dir`, run from `cwd`, without its duration. */
function reportOf(dir: string, cwd: string): Report {
  const run = cli(["scan", dir, "--json"], { cwd });
  if (run.status === 1) throw new Error(`scan failed: ${run.stderr}`);
  const report = JSON.parse(run.stdout) as Report;
  report.stats.durationMs = 0;
  return report;
}

const bodyOf = (r: Report, path: string): unknown => r.calls.find((c) => c.pathTemplate === path)?.body;

describe("a report depends on the scanned directory only (#112)", () => {
  it("reads no package or type above the scanned directory, nor from where the scan runs", () => {
    const alone = path.join(tempRepo(under("checkout", PROJECT)), "checkout");
    const parent = tempRepo({ ...PACKAGES, ...under("checkout", PROJECT) });
    const report = reportOf(path.join(parent, "checkout"), parent);
    expect(report).toEqual(reportOf(alone, alone));
    expect(bodyOf(report, "/v1/users")).not.toMatchObject({ properties: { password: { type: "string" } } });
    expect(bodyOf(report, "/v1/invites")).not.toMatchObject({ fromType: "InviteInput" });
  });

  it("reads the packages installed inside it", () => {
    const repo = tempRepo({ ...PROJECT, ...PACKAGES });
    const report = reportOf(repo, repo);
    expect(bodyOf(report, "/v1/users")).toMatchObject({ properties: { password: { type: "string" } } });
    expect(bodyOf(report, "/v1/invites")).toMatchObject({ fromType: "InviteInput", properties: { role: { type: "string" } } });
  });

  it("reads a tsconfig above it in its repository only", () => {
    const code = {
      "src/limits/quota.ts": `export const MAX_SEATS = 5;`,
      "src/billing.ts": [`import { MAX_SEATS } from "@limits/quota";`, `export const buy = () => fetch("https://api.example.com/v1/seats", { method: "POST", body: JSON.stringify({ seats: MAX_SEATS }) });`].join("\n"),
    };
    const aliases = JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@limits/*": ["checkout/src/limits/*"] } } });
    const alone = path.join(tempRepo(under("checkout", code)), "checkout");
    const above = tempRepo({ "tsconfig.json": aliases, ...under("checkout", code) });
    const report = reportOf(path.join(above, "checkout"), above);
    expect(report).toEqual(reportOf(alone, alone));
    expect(bodyOf(report, "/v1/seats")).not.toMatchObject({ properties: { seats: { enum: [5] } } });
    const repo = tempRepo({ ".git/HEAD": "ref: refs/heads/main\n", "tsconfig.json": aliases, ...under("checkout", code) });
    expect(bodyOf(reportOf(path.join(repo, "checkout"), repo), "/v1/seats")).toMatchObject({ properties: { seats: { enum: [5] } } });
  });
});
