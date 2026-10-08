import { describe, expect, it } from "vitest";
import type { IrRegistryEntry } from "../../src/lang/ir/language.js";
import { phpLanguage } from "../../src/lang/php/index.js";
import { normalizeComposer } from "../../src/lang/php/manifests.js";
import { pythonLanguage } from "../../src/lang/python/index.js";
import { normalizePypi } from "../../src/lang/python/manifests.js";
import { PROVIDERS, sdkPackages } from "../../src/normalize/provider.js";

const SOURCE_RE = /^(?:(?:arg|kw|instance):\w+(?:\.\w+)?|seg:\w+:\d+|chain:[\w,]+|(?:arg|kw)(?:\|\w+)*)$/;

function checkRegistry(entries: IrRegistryEntry[], ecosystem: "pypi" | "composer"): void {
  const ids = new Set(PROVIDERS.map((p) => p.id));
  const normalize = ecosystem === "pypi" ? normalizePypi : normalizeComposer;
  const known = new Set([...sdkPackages(ecosystem).keys()].map(normalize));
  for (const e of entries) {
    expect(ids, `${e.package}: provider ${e.provider}`).toContain(e.provider);
    expect(e.imports.length, `${e.package}: imports`).toBeGreaterThan(0);
    // coverage can only mark the package `supported` when providers.json lists it
    expect(known, `${e.package} is not in providers.json packages.${ecosystem}`).toContain(normalize(e.package));
    for (const [key, spec] of Object.entries(e.methods)) {
      expect(spec.method, `${e.package} ${key}`).toMatch(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)$/);
      expect(spec.path.startsWith("/"), `${e.package} ${key}: ${spec.path}`).toBe(true);
      for (const source of Object.values(spec.params ?? {})) expect(source, `${e.package} ${key}`).toMatch(SOURCE_RE);
      for (const name of Object.keys(spec.params ?? {})) expect(spec.path, `${e.package} ${key}: param ${name}`).toContain(`{${name}}`);
    }
  }
}

describe("tree-sitter language registries", () => {
  it("python: providers exist, packages are known, params are well formed", () => {
    checkRegistry(pythonLanguage.registry, "pypi");
  });

  it("php: providers exist, packages are known, params are well formed", () => {
    checkRegistry(phpLanguage.registry, "composer");
  });

  it("php: every Composer package with a provider has its namespaces", () => {
    for (const pkg of sdkPackages("composer").keys()) expect(phpLanguage.importRoots(pkg).length, pkg).toBeGreaterThan(0);
  });

  it("every client table names an import root and known option roles", () => {
    for (const c of [...pythonLanguage.clients, ...phpLanguage.clients]) {
      expect(c.imports.length > 0 || c.global).toBe(true);
      for (const role of Object.values(c.keys)) expect(role).toMatch(/^(?:url|baseUrl|method|query|headers|auth(?::(?:bearer|basic))?|body(?::(?:json|form|multipart|raw))?)$/);
    }
  });
});
