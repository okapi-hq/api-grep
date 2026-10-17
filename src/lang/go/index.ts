import { SHARED_EXCLUDES } from "../files.js";
import type { ClientSpec, IrLanguage, IrRegistryEntry } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import clients from "./clients.json" with { type: "json" };
import constants from "./constants.json" with { type: "json" };
import { linkGo } from "./link.js";
import { lowerGo } from "./lower.js";
import { goManifests, normalizeGoModule } from "./manifests.js";
import { importRoot } from "./names.js";
import { detectNewRequest } from "./nethttp.js";
import { goResolveCall } from "./structs.js";
import anthropicSdkGo from "./registry/anthropic-sdk-go.json" with { type: "json" };
import genai from "./registry/genai.json" with { type: "json" };
import goOpenai from "./registry/go-openai.json" with { type: "json" };
import openaiGo from "./registry/openai-go.json" with { type: "json" };
import slackGo from "./registry/slack-go.json" with { type: "json" };
import discordgo from "./registry/discordgo.json" with { type: "json" };
import sentryGo from "./registry/sentry-go.json" with { type: "json" };

/**
 * Registries and client tables name Go import paths (`github.com/sashabaranov/go-openai`); the engine matches dotted
 * roots, so they are read as `importRoot` writes them (`github_com.sashabaranov.go-openai`).
 */
const rooted = <T extends { imports: string[] }>(entries: T[]): T[] => entries.map((e) => ({ ...e, imports: e.imports.map(importRoot) }));

/**
 * A module's major versions are modules of their own (`github.com/openai/openai-go/v3`): one entry per version, so a
 * call names the module the code imports and `coverage.sdks` counts it there.
 */
function majorVersions(entries: (IrRegistryEntry & { majorVersions?: string[] })[]): IrRegistryEntry[] {
  return entries.flatMap(({ majorVersions: majors, ...e }) => [
    e,
    ...(majors ?? []).map((v) => ({ ...e, package: `${e.package}/${v}`, imports: e.imports.map((i) => (i === e.package ? `${i}/${v}` : i)) })),
  ]);
}

export const GO_REGISTRY = rooted(majorVersions([goOpenai, openaiGo, anthropicSdkGo, genai, slackGo, discordgo, sentryGo] as unknown as IrRegistryEntry[]));

export const GO_EXCLUDES = [...SHARED_EXCLUDES, "**/vendor/**", "**/testdata/**", "**/*_test.go"];

export const goLanguage: IrLanguage = {
  id: "go",
  ecosystem: "go",
  grammar: "go",
  extensions: [".go"],
  // the grammar wants a newline after the last declaration: a file without one parses once it is added (nothing moves)
  repair: (text) => `${text}\n`,
  excludes: GO_EXCLUDES,
  lower: lowerGo,
  // the files of a directory are one package: its types, functions and package-level names are shared
  link: linkGo,
  moduleVarsVisible: true,
  sharedGlobals: false,
  packageScope: true,
  typedParams: true,
  registry: GO_REGISTRY,
  clients: rooted(clients.clients as unknown as ClientSpec[]),
  detectors: [detectNewRequest],
  // a struct literal is the dict it serializes to; SDK helpers (`openai.UserMessage(m)`) what they build
  resolveCall: goResolveCall,
  constants: constants.constants,
  // `form := url.Values{}; form.Set("to", to)`: a form built entry by entry
  fluentMaps: [{ objects: ["url.Values"], put: ["Set", "Add"], encoding: "form" }],
  passthrough: { functions: new Set(), methods: new Set(["String", "Encode"]) },
  serializers: { "json.Marshal": "json", "json.MarshalIndent": "json", "xml.Marshal": "xml", "xml.MarshalIndent": "xml" },
  manifests: goManifests(),
  // a module path is the prefix of its packages' import paths
  importRoots: (pkg) => [importRoot(pkg)],
  normalizePackage: normalizeGoModule,
};

export const go = irLanguage(goLanguage);
