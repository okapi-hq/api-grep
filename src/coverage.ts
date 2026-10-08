import path from "node:path";
import type { Call, Ecosystem, SdkCoverage } from "./report/schema.js";

export { sdkCoverage } from "./lang/typescript/coverage.js";

export interface CoverageInput {
  ecosystem: Ecosystem;
  /** Known API SDK packages of the ecosystem -> provider id. */
  known: Map<string, string>;
  /** Packages declared by the manifests the scan covered. */
  declared: Set<string>;
  /** Package -> scanned files that import it. */
  sites: Map<string, number>;
  calls: Call[];
  /** A registry exists for the package, so its calls can be listed. */
  supported: (pkg: string) => boolean;
}

function statusOf(s: Omit<SdkCoverage, "status">): SdkCoverage["status"] {
  if (!s.imported) return "declared-not-imported";
  if (!s.supported) return "unsupported";
  return s.calls > 0 ? "ok" : "imported-no-calls";
}

/**
 * Compares the API SDKs a repo declares and imports with the calls found, so "0 Supabase calls" never reads as
 * "this repo does not use Supabase". Files that could not be read are not counted as import sites.
 */
export function coverageRows(input: CoverageInput): SdkCoverage[] {
  const callCounts = new Map<string, number>();
  for (const c of input.calls) if (c.sdk) callCounts.set(c.sdk.package, (callCounts.get(c.sdk.package) ?? 0) + 1);
  const sites = [...input.sites.keys()].filter((p) => input.known.has(p));
  const packages = new Set([...[...input.declared].filter((p) => input.known.has(p)), ...sites]);
  return [...packages].sort().map((pkg) => {
    const base = {
      package: pkg,
      ecosystem: input.ecosystem,
      provider: input.known.get(pkg)!,
      supported: input.supported(pkg),
      declared: input.declared.has(pkg),
      imported: input.sites.has(pkg),
      importSites: input.sites.get(pkg) ?? 0,
      calls: callCounts.get(pkg) ?? 0,
    };
    return { ...base, status: statusOf(base) };
  });
}

/** The scanned directory and every directory between it and a scanned file: where manifests are looked for. */
export function manifestDirs(rootDir: string, files: string[]): Set<string> {
  const dirs = new Set<string>([rootDir]);
  for (const f of files) {
    for (let dir = path.dirname(f); dir.startsWith(rootDir) && !dirs.has(dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  return dirs;
}
