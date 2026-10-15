import { SHARED_EXCLUDES } from "../files.js";
import type { ClientSpec, IrLanguage, IrRegistryEntry } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import clients from "./clients.json" with { type: "json" };
import constants from "./constants.json" with { type: "json" };
import { linkRust } from "./link.js";
import { lowerRust } from "./lower.js";
import { cargoManifests, normalizeCrate } from "./manifests.js";
import { repairRust } from "./repair.js";
import { detectRustRequest } from "./requests.js";
import { rustResolveCall } from "./structs.js";
import asyncOpenai from "./registry/async-openai.json" with { type: "json" };
import openaiApiRs from "./registry/openai-api-rs.json" with { type: "json" };
import serenity from "./registry/serenity.json" with { type: "json" };
import teloxide from "./registry/teloxide.json" with { type: "json" };

export const RUST_REGISTRY = [asyncOpenai, openaiApiRs, teloxide, serenity] as unknown as IrRegistryEntry[];

/**
 * Build output, vendored crates, integration tests, benchmarks, build scripts and the files unit tests are kept in by
 * convention (`tests.rs`, `*_tests.rs`); `#[cfg(test)]` modules are skipped while lowering, and the files a `#[cfg(test)]
 * mod x;` declares are left without calls.
 */
export const RUST_EXCLUDES = [...SHARED_EXCLUDES, "**/target/**", "**/vendor/**", "**/tests/**", "**/benches/**", "**/build.rs", "**/tests.rs", "**/*_tests.rs", "**/*_test.rs"];

/** A crate's name as its code writes it: `async-openai` is used as `async_openai`. */
export const crateRoot = (pkg: string): string => normalizeCrate(pkg).replace(/-/g, "_");

export const rustLanguage: IrLanguage = {
  id: "rust",
  ecosystem: "cargo",
  grammar: "rust",
  extensions: [".rs"],
  // syntax the grammar does not know yet (`&raw` as a variable, attributes on pattern fields), rewritten in place
  repair: repairRust,
  excludes: RUST_EXCLUDES,
  lower: lowerRust,
  // an `impl` of a type declared in another module, and struct literals giving a type's fields their values
  link: linkRust,
  moduleVarsVisible: true,
  sharedGlobals: false,
  typedParams: true,
  registry: RUST_REGISTRY,
  clients: clients.clients as unknown as ClientSpec[],
  detectors: [detectRustRequest],
  // a struct literal is the dict serde serializes it to; SDK request builders (`...Args::default().model(m).build()`) too
  resolveCall: rustResolveCall,
  constants: constants.constants,
  // `let mut headers = HeaderMap::new(); headers.insert(AUTHORIZATION, v);`, a map filled entry by entry
  fluentMaps: [{ objects: ["HeaderMap.new", "HeaderMap.with_capacity", "HashMap.new", "HashMap.with_capacity", "BTreeMap.new", "Map.new", "IndexMap.new"], put: ["insert", "append"], filledOnly: true }],
  passthrough: { functions: new Set(), methods: new Set(["to_string", "to_owned", "as_str", "clone", "into"]) },
  serializers: { to_string: "json", to_vec: "json", to_string_pretty: "json", to_vec_pretty: "json" },
  manifests: cargoManifests(),
  importRoots: (pkg) => [crateRoot(pkg)],
  normalizePackage: normalizeCrate,
};

export const rust = irLanguage(rustLanguage);
