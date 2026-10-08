import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { packageFromSpecifier, specifierOf } from "./detect/origin.js";
import type { Registry } from "./detect/registry/index.js";
import { PROVIDERS } from "./normalize/provider.js";
import type { Call, Coverage, SdkCoverage } from "./report/schema.js";

/** Known API SDK packages (from providers.json) -> provider id. */
const SDK_PACKAGES = new Map<string, string>();
for (const p of PROVIDERS) for (const pkg of p.packages ?? []) if (!SDK_PACKAGES.has(pkg)) SDK_PACKAGES.set(pkg, p.id);

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** `dependencies` and `peerDependencies` of every package.json between the scanned files and the scanned directory. */
function declaredPackages(rootDir: string, files: SourceFile[]): Set<string> {
  const dirs = new Set<string>([rootDir]);
  for (const sf of files) {
    for (let dir = path.dirname(sf.getFilePath()); dir.startsWith(rootDir) && !dirs.has(dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  const out = new Set<string>();
  for (const dir of dirs) {
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(readFileSync(file, "utf8")) as PackageJson;
      for (const name of [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})]) out.add(name);
    } catch {
      // an unreadable package.json declares nothing
    }
  }
  return out;
}

/** Packages a file loads at runtime: import / export-from declarations (not `import type`), `require()` and `import()`. */
function importedPackages(sf: SourceFile): Set<string> {
  const specs: string[] = [];
  for (const d of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const spec = specifierOf(d);
    if (spec && !d.isTypeOnly()) specs.push(spec);
  }
  const text = sf.getFullText();
  if (text.includes("require(") || text.includes("import(")) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      const arg = call.getArguments()[0];
      const loads = callee.getKind() === SyntaxKind.ImportKeyword || callee.getText() === "require";
      if (loads && arg && Node.isStringLiteral(arg)) specs.push(arg.getLiteralValue());
    }
  }
  return new Set(specs.map(packageFromSpecifier).filter((p): p is string => !!p));
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
export function sdkCoverage(rootDir: string, files: SourceFile[], calls: Call[], registry: Registry): Coverage {
  const declared = declaredPackages(rootDir, files);
  const sites = new Map<string, number>();
  for (const sf of files) {
    for (const pkg of importedPackages(sf)) if (SDK_PACKAGES.has(pkg)) sites.set(pkg, (sites.get(pkg) ?? 0) + 1);
  }
  const callCounts = new Map<string, number>();
  for (const c of calls) if (c.sdk) callCounts.set(c.sdk.package, (callCounts.get(c.sdk.package) ?? 0) + 1);
  const packages = new Set([...[...declared].filter((p) => SDK_PACKAGES.has(p)), ...sites.keys()]);
  const sdks = [...packages].sort().map((pkg) => {
    const base = {
      package: pkg,
      provider: SDK_PACKAGES.get(pkg)!,
      supported: !!registry.byPackage(pkg),
      declared: declared.has(pkg),
      imported: sites.has(pkg),
      importSites: sites.get(pkg) ?? 0,
      calls: callCounts.get(pkg) ?? 0,
    };
    return { ...base, status: statusOf(base) };
  });
  return { sdks };
}
