import { SHARED_EXCLUDES } from "../files.js";
import type { IrLanguage } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import { JVM_HTTP } from "../jvm/http/index.js";
import { jvmManifests, normalizeMaven } from "../jvm/manifests.js";
import { jvmImportRoots } from "../jvm/packages.js";
import { JVM_REGISTRY } from "../jvm/registry/index.js";
import { javaSource } from "../java/index.js";
import { jvmResolveCall } from "../jvm/lombok.js";
import { JVM_INJECTION } from "../jvm/di/inject.js";
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
  // one front end and one index for the JVM: a Kotlin file calls a Retrofit interface declared in Java, and back
  alsoReads: [javaSource],
  moduleVarsVisible: true,
  sharedGlobals: false,
  packageScope: true,
  typedParams: true,
  overloads: true,
  registry: JVM_REGISTRY,
  ...JVM_HTTP,
  // `X.builder().a(1).build()` of an SDK's parameter class or a Lombok `@Builder` class: the dict of the fields it
  // sets; a Lombok getter: its field
  resolveCall: jvmResolveCall,
  // Dagger / Hilt, Spring and Koin bindings: injected parameters and fields, `get<T>()` (#46)
  injection: JVM_INJECTION,
  passthrough: {
    functions: new Set([
      ...["URL", "URI", "Url", "encode", "requireNotNull", "checkNotNull", "URI.create", "Uri.parse", "HttpUrl.get", "HttpUrl.parse", "MediaType.get", "MediaType.parse"],
      // Java
      ...["String.valueOf", "Objects.requireNonNull"],
    ]),
    methods: new Set([
      ...["trim", "trimEnd", "trimStart", "trimIndent", "trimMargin", "removeSuffix", "lowercase", "uppercase", "toString", "orEmpty"],
      ...["toHttpUrl", "toHttpUrlOrNull", "toUri", "toURI", "toURL", "toMediaType", "toMediaTypeOrNull", "toByteArray", "encodeToByteArray"],
      // Java
      ...["getBytes", "strip", "toLowerCase", "toUpperCase"],
    ]),
  },
  serializers: { toJson: "json", encodeToString: "json", writeValueAsString: "json" },
  manifests: jvmManifests(),
  importRoots: jvmImportRoots,
  normalizePackage: normalizeMaven,
};

/** The JVM front end: Kotlin and Java files in one index. */
export const kotlin = irLanguage(kotlinLanguage);
