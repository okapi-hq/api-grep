import { parse as parseToml } from "smol-toml";

/** A library of a Gradle version catalog: Maven coordinates and its version, when the catalog gives one. */
export interface CatalogLibrary {
  group: string;
  artifact: string;
  version?: string;
}

/** `gradle/libs.versions.toml`: libraries and bundles by the accessor build scripts use (`libs.okhttp.logging`). */
export interface Catalog {
  libraries: Map<string, CatalogLibrary>;
  bundles: Map<string, string[]>;
}

/** Gradle turns `-`, `_` and `.` in an alias into the accessor's dots: `okhttp-logging` is `libs.okhttp.logging`. */
export const accessor = (alias: string): string => alias.replace(/[-_.]/g, ".");

type Version = string | { strictly?: string; require?: string; prefer?: string; ref?: string } | undefined;

function versionOf(v: Version, versions: Record<string, unknown>): string | undefined {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return undefined;
  if (typeof v.ref === "string") return Object.hasOwn(versions, v.ref) ? versionOf(versions[v.ref] as Version, {}) : undefined;
  return [v.strictly, v.require, v.prefer].find((x): x is string => typeof x === "string");
}

type LibraryEntry = string | { module?: string; group?: string; name?: string; version?: Version };

function library(entry: LibraryEntry, versions: Record<string, unknown>): CatalogLibrary | undefined {
  if (typeof entry === "string") {
    const [group, artifact, version] = entry.split(":");
    return group && artifact ? { group, artifact, ...(version ? { version } : {}) } : undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  const [group, artifact] = typeof entry.module === "string" ? entry.module.split(":") : [entry.group, entry.name];
  if (typeof group !== "string" || typeof artifact !== "string") return undefined;
  const version = versionOf(entry.version, versions);
  return { group, artifact, ...(version ? { version } : {}) };
}

/** A version catalog; one that does not parse lists nothing. */
export function parseCatalog(text: string): Catalog {
  const out: Catalog = { libraries: new Map(), bundles: new Map() };
  let toml: { versions?: Record<string, unknown>; libraries?: Record<string, LibraryEntry>; bundles?: Record<string, unknown> };
  try {
    toml = parseToml(text);
  } catch {
    return out;
  }
  const versions = toml.versions && typeof toml.versions === "object" ? toml.versions : {};
  for (const [alias, entry] of Object.entries(toml.libraries ?? {})) {
    const lib = library(entry, versions);
    if (lib) out.libraries.set(accessor(alias), lib);
  }
  for (const [alias, members] of Object.entries(toml.bundles ?? {})) {
    if (Array.isArray(members)) out.bundles.set(accessor(alias), members.filter((m): m is string => typeof m === "string").map(accessor));
  }
  return out;
}

/** The libraries a `libs.<accessor>` reference stands for: one library, or every library of `libs.bundles.<name>`. */
export function catalogLibraries(catalog: Catalog, ref: string): CatalogLibrary[] {
  const bundle = ref.startsWith("bundles.") ? catalog.bundles.get(ref.slice("bundles.".length)) : undefined;
  if (bundle) return bundle.flatMap((a) => catalog.libraries.get(a) ?? []);
  const lib = catalog.libraries.get(ref);
  return lib ? [lib] : [];
}
