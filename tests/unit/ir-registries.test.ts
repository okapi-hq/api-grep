import { describe, expect, it } from "vitest";
import { dartLanguage } from "../../src/lang/dart/index.js";
import { normalizePub } from "../../src/lang/dart/manifests.js";
import { goLanguage } from "../../src/lang/go/index.js";
import { normalizeGoModule } from "../../src/lang/go/manifests.js";
import { rustLanguage } from "../../src/lang/rust/index.js";
import { normalizeCrate } from "../../src/lang/rust/manifests.js";
import type { IrRegistryEntry } from "../../src/lang/ir/language.js";
import { normalizeMaven } from "../../src/lang/jvm/manifests.js";
import { kotlinLanguage } from "../../src/lang/kotlin/index.js";
import { phpLanguage } from "../../src/lang/php/index.js";
import { normalizeComposer } from "../../src/lang/php/manifests.js";
import { pythonLanguage } from "../../src/lang/python/index.js";
import { normalizePypi } from "../../src/lang/python/manifests.js";
import { PROVIDERS, sdkPackages } from "../../src/normalize/provider.js";

const ONE_SOURCE = String.raw`(?:arg|kw|instance):\w+(?:\.\w+)?|seg:\w+:\d+|chain:[\w,]+|model`;
// one source, or several tried in turn (`kw:request.name|arg:0`)
const SOURCE_RE = new RegExp(`^(?:${ONE_SOURCE})(?:\\|(?:${ONE_SOURCE}))*$|^(?:arg|kw)(?:\\|\\w+)*$`);

const NORMALIZE = { pypi: normalizePypi, composer: normalizeComposer, maven: normalizeMaven, go: normalizeGoModule, cargo: normalizeCrate, pub: normalizePub };

function checkRegistry(entries: IrRegistryEntry[], ecosystem: keyof typeof NORMALIZE): void {
  const ids = new Set(PROVIDERS.map((p) => p.id));
  const normalize = NORMALIZE[ecosystem];
  const known = new Set([...sdkPackages(ecosystem).keys()].map(normalize));
  for (const e of entries) {
    expect(ids, `${e.package}: provider ${e.provider}`).toContain(e.provider);
    expect(e.imports.length, `${e.package}: imports`).toBeGreaterThan(0);
    // coverage can only mark the package `supported` when providers.json lists it
    expect(known, `${e.package} is not in providers.json packages.${ecosystem}`).toContain(normalize(e.package));
    for (const [key, spec] of Object.entries(e.methods)) {
      expect(spec.method, `${e.package} ${key}`).toMatch(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)$/);
      // a GraphQL client's endpoint is the URL the code gives it, with nothing appended; so is an A2A agent's
      expect(e.endpoint || spec.a2a !== undefined ? spec.path === "" : spec.path.startsWith("/"), `${e.package} ${key}: ${spec.path}`).toBe(true);
      for (const source of Object.values(spec.params ?? {})) expect(source, `${e.package} ${key}`).toMatch(SOURCE_RE);
      const withId = spec.record?.withId;
      const paths = [spec.path, spec.argPath?.path, ...(spec.paths ?? []), withId?.path, ...(withId?.paths ?? [])].join(" ");
      for (const name of Object.keys(spec.params ?? {})) expect(paths, `${e.package} ${key}: param ${name}`).toContain(`{${name}}`);
      for (const p of [...(spec.paths ?? []), ...(withId?.paths ?? [])]) expect(p.startsWith("/"), `${e.package} ${key}: ${p}`).toBe(true);
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

  it("jvm: providers exist, packages are known, params are well formed", () => {
    checkRegistry(kotlinLanguage.registry, "maven");
  });

  it("go: providers exist, packages are known, params are well formed", () => {
    // one entry per major version of a module (`github.com/openai/openai-go/v3`), each listed in providers.json
    checkRegistry(goLanguage.registry, "go");
    expect(goLanguage.registry.map((e) => e.package)).toContain("github.com/openai/openai-go/v3");
  });

  it("go: every module with a provider is a module path", () => {
    for (const pkg of sdkPackages("go").keys()) {
      expect(pkg, pkg).toMatch(/^[a-z0-9.-]+\.[a-z]+(?:\/[\w.-]+)+$/);
      expect(goLanguage.importRoots(pkg).every((r) => !r.includes("/")), pkg).toBe(true);
    }
  });

  it("rust: providers exist, packages are known, imports are crate paths as the code writes them", () => {
    checkRegistry(rustLanguage.registry, "cargo");
    for (const e of rustLanguage.registry) for (const i of e.imports) expect(i, e.package).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?:\.[A-Z]\w*)?$/);
    for (const pkg of sdkPackages("cargo").keys()) expect(pkg, pkg).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe("dart registries", () => {
  it("dart: providers exist, packages are pub.dev names, imports are a package and its classes", () => {
    checkRegistry(dartLanguage.registry, "pub");
    for (const e of dartLanguage.registry) for (const i of e.imports) expect(i, e.package).toMatch(/^[a-z][a-z0-9_]*(?:\.[A-Z]\w*)?$/);
    for (const pkg of sdkPackages("pub").keys()) expect(pkg, pkg).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("jvm: imports are classes or packages, setter rules name packages of the SDK", () => {
    for (const e of kotlinLanguage.registry) {
      for (const i of e.imports) expect(i, e.package).toMatch(/^[a-z][\w]*(?:\.[a-z][\w]*)+(?:\.[A-Z]\w*)?$/);
      for (const p of e.setters?.packages ?? []) expect(p, e.package).toMatch(/^[a-z][\w]*(?:\.[a-z][\w]*)+$/);
      for (const [pattern] of e.setters?.constantRewrites ?? []) expect(() => new RegExp(pattern), e.package).not.toThrow();
    }
  });

  it("php: every Composer package with a provider has its namespaces", () => {
    for (const pkg of sdkPackages("composer").keys()) expect(phpLanguage.importRoots(pkg).length, pkg).toBeGreaterThan(0);
  });

  it("maven: every artifact with a provider is a `group:artifact` with package roots", () => {
    for (const pkg of sdkPackages("maven").keys()) {
      expect(pkg, pkg).toMatch(/^[\w.-]+:[\w.-]+$/);
      expect(kotlinLanguage.importRoots(pkg).every((r) => /^[a-z][\w]*(?:\.[\w]+)*$/.test(r)), pkg).toBe(true);
    }
  });

  it("every client table names an import root and known option roles", () => {
    for (const c of [...pythonLanguage.clients, ...phpLanguage.clients, ...goLanguage.clients, ...rustLanguage.clients]) {
      expect(c.imports.length > 0 || c.global).toBe(true);
      for (const role of Object.values(c.keys)) expect(role).toMatch(/^(?:url|baseUrl|method|query|headers|auth(?::(?:bearer|basic))?|body(?::(?:json|form|multipart|raw))?)$/);
    }
  });
});
