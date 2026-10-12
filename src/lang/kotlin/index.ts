import { SHARED_EXCLUDES } from "../files.js";
import type { IrLanguage } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import { jvmManifests, normalizeMaven } from "../jvm/manifests.js";
import { jvmImportRoots } from "../jvm/packages.js";
import { lowerKotlin } from "./lower.js";
import { semicolonsBeforeBraces } from "./repair.js";

export const KOTLIN_EXCLUDES = [
  ...SHARED_EXCLUDES,
  // build scripts and build logic are configuration: read for manifests and BuildConfig values, never for calls
  "**/*.gradle.kts",
  "**/buildSrc/**",
  "**/build-logic/**",
  "**/.gradle/**",
  "**/src/test*/**",
  "**/src/androidTest*/**",
  "**/src/*Test/**",
  "**/test/**",
  "**/tests/**",
  "**/*Test.kt",
  "**/*Tests.kt",
];

export const kotlinLanguage: IrLanguage = {
  id: "kotlin",
  ecosystem: "maven",
  grammar: "kotlin",
  allowHiddenErrors: true,
  repair: semicolonsBeforeBraces,
  extensions: [".kt", ".kts"],
  excludes: KOTLIN_EXCLUDES,
  lower: lowerKotlin,
  moduleVarsVisible: true,
  sharedGlobals: false,
  packageScope: true,
  typedParams: true,
  // no HTTP client or SDK is read yet: Kotlin files are parsed and lowered, and the coverage lists their SDKs
  registry: [],
  clients: [],
  passthrough: {
    functions: new Set(["URL", "URI", "encode", "requireNotNull", "checkNotNull"]),
    methods: new Set(["trim", "trimEnd", "trimStart", "trimIndent", "trimMargin", "removeSuffix", "lowercase", "uppercase", "toString", "toHttpUrl", "toHttpUrlOrNull", "toUri", "toURI", "toURL", "orEmpty"]),
  },
  serializers: { toJson: "json", encodeToString: "json", writeValueAsString: "json" },
  manifests: jvmManifests(),
  importRoots: jvmImportRoots,
  normalizePackage: normalizeMaven,
};

export const kotlin = irLanguage(kotlinLanguage);
