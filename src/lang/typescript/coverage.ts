import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { coverageRows, manifestDirs } from "../../coverage.js";
import { AI_SDK_PACKAGES } from "../../detect/ai-sdk.js";
import { packageFromSpecifier, specifierOf } from "../../detect/origin.js";
import type { Registry } from "../../detect/registry/index.js";
import { sdkPackages } from "../../normalize/provider.js";
import type { Call, Coverage } from "../../report/schema.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** `dependencies` and `peerDependencies` of every package.json between the scanned files and the scanned directory. */
function declaredPackages(rootDir: string, files: SourceFile[]): Set<string> {
  const out = new Set<string>();
  for (const dir of manifestDirs(rootDir, files.map((sf) => sf.getFilePath()))) {
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

/** SDK coverage of the npm packages a TypeScript repo declares and imports. */
export function sdkCoverage(rootDir: string, files: SourceFile[], calls: Call[], registry: Registry): Coverage {
  const known = sdkPackages("npm");
  const sites = new Map<string, number>();
  for (const sf of files) for (const pkg of importedPackages(sf)) if (known.has(pkg)) sites.set(pkg, (sites.get(pkg) ?? 0) + 1);
  const supported = (pkg: string): boolean => !!registry.byPackage(pkg) || AI_SDK_PACKAGES.has(pkg);
  return { sdks: coverageRows({ ecosystem: "npm", known, declared: declaredPackages(rootDir, files), sites, calls, supported }) };
}
