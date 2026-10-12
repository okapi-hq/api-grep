import path from "node:path";
import { isInside, readConfigFile } from "../../files.js";
import type { Manifests } from "../ir/language.js";
import { catalogLibraries, parseCatalog, type Catalog } from "./catalog.js";
import { gradleDependencies, gradleVariables, resolveVersion } from "./gradle.js";
import { parsePom, pomVersion, type Pom } from "./maven.js";

/** Maven coordinates as `group:artifact`, matched case-insensitively. */
export function normalizeMaven(name: string): string {
  return name.trim().toLowerCase();
}

type Deps = Map<string, string | undefined>;

const BUILD_SCRIPTS = ["build.gradle.kts", "build.gradle"];

/** `dir` and its parents up to the scanned root, nearest first. */
export function upwards(dir: string, rootDir: string): string[] {
  const out: string[] = [];
  for (let d = dir; isInside(rootDir, d); d = path.dirname(d)) {
    out.push(d);
    if (d === rootDir || path.dirname(d) === d) break;
  }
  return out;
}

function add(deps: Deps, group: string, artifact: string, version: string | undefined): void {
  // a coordinate built from variables (`"$group:core:1.0"`) names nothing statically
  if (/[${}]/.test(group + artifact)) return;
  const key = normalizeMaven(`${group}:${artifact}`);
  if (!deps.has(key)) deps.set(key, version);
}

function parseProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\w.-]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m && !props.has(m[1]!)) props.set(m[1]!, m[2]!);
  }
  return props;
}

/** Reads and caches what the manifests of one scanned directory tree say; every file is read like other config files. */
class JvmFiles {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly rootDir: string) {}

  private memo<T>(key: string, make: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key) as T;
  }

  private read(file: string): string | undefined {
    return readConfigFile(file, this.rootDir);
  }

  /** The nearest `gradle/libs.versions.toml` (the root project's): libraries by accessor. */
  catalog(dir: string): Catalog | undefined {
    return this.memo(`catalog\0${dir}`, () => {
      for (const d of upwards(dir, this.rootDir)) {
        const text = this.read(path.join(d, "gradle", "libs.versions.toml"));
        if (text !== undefined) return parseCatalog(text);
      }
      return undefined;
    });
  }

  /** `gradle.properties` of the directory and its parents, nearest first. */
  private gradleProperty(dir: string, name: string): string | undefined {
    for (const d of upwards(dir, this.rootDir)) {
      const props = this.memo(`props\0${d}`, () => parseProperties(this.read(path.join(d, "gradle.properties")) ?? ""));
      const v = props.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  pom(dir: string): Pom | undefined {
    return this.memo(`pom\0${dir}`, () => {
      const text = this.read(path.join(dir, "pom.xml"));
      return text === undefined ? undefined : parsePom(text);
    });
  }

  gradle(dir: string, deps: Deps): void {
    for (const name of BUILD_SCRIPTS) {
      const text = this.read(path.join(dir, name));
      if (text === undefined) continue;
      const vars = gradleVariables(text);
      const lookup = (v: string): string | undefined => vars.get(v) ?? this.gradleProperty(dir, v);
      const catalog = this.catalog(dir);
      for (const d of gradleDependencies(text)) {
        if (!("catalog" in d)) add(deps, d.group, d.artifact, resolveVersion(d.version, lookup));
        else for (const lib of catalog ? catalogLibraries(catalog, d.catalog) : []) add(deps, lib.group, lib.artifact, lib.version);
      }
    }
  }

  /** A pom's dependencies; versions from its properties and `dependencyManagement`, then its parent directories' poms. */
  maven(dir: string, deps: Deps): void {
    const pom = this.pom(dir);
    if (!pom) return;
    const chain = upwards(dir, this.rootDir).flatMap((d) => this.pom(d) ?? []);
    const prop = (name: string): string | undefined => chain.map((p) => p.properties.get(name)).find((v) => v !== undefined);
    for (const d of pom.dependencies) {
      const managed = chain.map((p) => p.managed.get(`${d.group}:${d.artifact}`)).find((v) => v !== undefined);
      add(deps, d.group, d.artifact, pomVersion(d.version ?? managed, prop));
    }
  }
}

/** JVM manifests: Gradle build scripts (Kotlin and Groovy DSL) with the version catalog, and pom.xml. */
export function jvmManifests(): Manifests {
  const trees = new Map<string, JvmFiles>();
  const deps = new Map<string, Deps>();
  const depsOf = (dir: string, rootDir: string): Deps => {
    const key = `${rootDir}\0${dir}`;
    let d = deps.get(key);
    if (!d) {
      let files = trees.get(rootDir);
      if (!files) trees.set(rootDir, (files = new JvmFiles(rootDir)));
      d = new Map();
      files.gradle(dir, d);
      files.maven(dir, d);
      deps.set(key, d);
    }
    return d;
  };
  return {
    declared: (dirs, rootDir) => new Set([...dirs].flatMap((d) => [...depsOf(d, rootDir).keys()])),
    version: (file, pkg, rootDir) => {
      const name = normalizeMaven(pkg);
      for (const dir of upwards(path.dirname(file), rootDir)) {
        const d = depsOf(dir, rootDir);
        if (d.has(name)) return d.get(name);
      }
      return undefined;
    },
  };
}
