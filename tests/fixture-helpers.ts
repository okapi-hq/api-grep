import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJson } from "../src/report/json.js";
import type { Call, Report } from "../src/report/schema.js";
import { scan, type ScanOptions } from "../src/scan.js";

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Fixture directories hold one fixture each; nested directories are fixtures of their own and are left out. */
export async function scanFixture(name: string, opts: Partial<ScanOptions> = {}): Promise<Report> {
  const report = await scan({ dir: path.join(FIXTURES, name), exclude: ["*/**"], ...opts });
  const json = JSON.parse(toJson(report)) as Report;
  json.stats.durationMs = 0;
  // the release and the build would change every snapshot
  json.version = "<version>";
  delete json.commit;
  return json;
}

export const at = (r: Report, file: string, line: number): Call => {
  const c = r.calls.find((x) => x.location.file === file && x.location.line === line);
  if (!c) throw new Error(`no call at ${file}:${line}; have ${r.calls.map((x) => `${x.location.file}:${x.location.line}`).join(", ")}`);
  return c;
};
