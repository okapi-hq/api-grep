import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { coverageRows, manifestDirs } from "../../coverage.js";
import { AI_SDK_AGENTS, AI_SDK_PACKAGES } from "../../detect/ai-sdk.js";
import { packageFromSpecifier, specifierOf } from "../../ast/origin.js";
import type { Registry } from "../../detect/registry/index.js";
import { sdkPackages } from "../../normalize/provider.js";
import { PackageJsonReader } from "../../package-json.js";
import type { Call, Coverage } from "../../report/schema.js";
import { usedAsTypesOnly } from "./type-imports.js";

/** `dependencies` and `peerDependencies` of every package.json between the scanned files and the scanned directory. */
export function declaredPackages(rootDir: string, files: string[], packages: PackageJsonReader): Set<string> {
  const out = new Set<string>();
  for (const dir of manifestDirs(rootDir, files)) {
    const json = packages.read(dir);
    for (const name of [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})]) out.add(name);
  }
  return out;
}

const NPM_SDKS = sdkPackages("npm");

/**
 * Packages a file loads at runtime: import / export-from declarations (not `import type`, nor an import of an SDK whose
 * bindings are only used as types), `require()` and `import()`.
 */
export function importedPackages(sf: SourceFile): Set<string> {
  const specs: string[] = [];
  for (const d of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const spec = specifierOf(d);
    if (!spec || d.isTypeOnly()) continue;
    const pkg = packageFromSpecifier(spec);
    if (pkg && NPM_SDKS.has(pkg) && Node.isImportDeclaration(d) && usedAsTypesOnly(d)) continue;
    specs.push(spec);
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

/** An HTML page and the npm packages it loads from a CDN (`<script src="https://cdn.jsdelivr.net/npm/axios">`). */
export interface PageImports {
  file: string;
  packages: string[];
}

/** SDK coverage of the npm packages a TypeScript / JavaScript repo declares and imports (HTML pages through CDN scripts). */
export function sdkCoverage(rootDir: string, files: SourceFile[], calls: Call[], registry: Registry, pages: PageImports[] = [], packageJsons = new PackageJsonReader(rootDir)): Coverage {
  const imports = new Map<string, Set<string>>();
  for (const sf of files) imports.set(sf.getFilePath(), importedPackages(sf));
  return importsCoverage(rootDir, imports, calls, registry, pages, packageJsons);
}

/** `sdkCoverage` from the packages each scanned file imports (`importedPackages`), read while its project was alive. */
export function importsCoverage(rootDir: string, files: Map<string, Set<string>>, calls: Call[], registry: Registry, pages: PageImports[], packageJsons: PackageJsonReader): Coverage {
  const known = sdkPackages("npm");
  const sites = new Map<string, number>();
  const imports = new Map(files);
  for (const p of pages) imports.set(p.file, new Set([...(imports.get(p.file) ?? []), ...p.packages]));
  for (const pkgs of imports.values()) for (const pkg of pkgs) if (known.has(pkg)) sites.set(pkg, (sites.get(pkg) ?? 0) + 1);
  const supported = (pkg: string): boolean => !!registry.byPackage(pkg) || AI_SDK_PACKAGES.has(pkg);
  const extraCalls = agentCalls(rootDir, imports, calls);
  return { sdks: coverageRows({ ecosystem: "npm", known, declared: declaredPackages(rootDir, [...imports.keys()], packageJsons), sites, calls, supported, extraCalls }) };
}

/** Requests of agent libraries' agents (`new Agent({ model: openai("gpt-4o") })`): the call's `sdk` names the model's package. */
function agentCalls(rootDir: string, imports: Map<string, Set<string>>, calls: Call[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of calls) {
    if (!c.sdk) continue;
    const pkgs = imports.get(path.resolve(rootDir, c.location.file));
    for (const [pkg, ctors] of AI_SDK_AGENTS) if (pkg !== c.sdk.package && ctors.includes(c.sdk.chain) && pkgs?.has(pkg)) out.set(pkg, (out.get(pkg) ?? 0) + 1);
  }
  return out;
}
