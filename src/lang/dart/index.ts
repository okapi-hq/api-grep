import { SHARED_EXCLUDES } from "../files.js";
import type { ClientSpec, IrLanguage, IrRegistryEntry } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import clients from "./clients.json" with { type: "json" };
import { linkDart } from "./link.js";
import { lowerDart } from "./lower.js";
import { normalizePub, pubManifests } from "./manifests.js";
import { detectDio } from "./dio.js";
import { DART_INJECTION } from "./inject.js";
import { detectHttpRequest } from "./requests.js";
import { dartResolveCall } from "./resolve.js";
import supabaseFlutter from "./registry/supabase-flutter.json" with { type: "json" };
import cloudFirestore from "./registry/cloud-firestore.json" with { type: "json" };
import firebaseAuth from "./registry/firebase-auth.json" with { type: "json" };

export const DART_REGISTRY = [supabaseFlutter, cloudFirestore, firebaseAuth] as unknown as IrRegistryEntry[];

/**
 * Tests, tool caches and generated code: `*.g.dart` (json_serializable, retrofit), `*.freezed.dart`, `*.mocks.dart`,
 * `*.gr.dart` (auto_route), `*.config.dart` (injectable), Flutter's plugin registrants.
 */
export const DART_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/.dart_tool/**",
  "**/.pub-cache/**",
  "**/.fvm/**",
  "**/test/**",
  "**/integration_test/**",
  "**/test_driver/**",
  "**/*_test.dart",
  "**/*.g.dart",
  "**/*.freezed.dart",
  "**/*.mocks.dart",
  "**/*.gr.dart",
  "**/*.config.dart",
  "**/generated_plugin_registrant.dart",
];

/** Names an import without a prefix gives a file, from the client libraries (`import 'package:dio/dio.dart';` -> `Dio`). */
const LIBRARY_NAMES = [
  ...["Dio", "DioForNative", "DioForBrowser", "BaseOptions", "Options", "RequestOptions", "FormData", "MultipartFile", "InterceptorsWrapper"].map((n) => `dio.${n}`),
  ...["Client", "IOClient", "BrowserClient", "RetryClient", "Request", "MultipartRequest", "get", "head", "read", "readBytes", "delete", "post", "put", "patch"].map((n) => `http.${n}`),
];

export const dartLanguage: IrLanguage = {
  id: "dart",
  ecosystem: "pub",
  grammar: "dart",
  extensions: [".dart"],
  excludes: DART_EXCLUDES,
  lower: lowerDart,
  // what an import without a prefix brings in: the names a project library exports, or a package's
  link: linkDart,
  moduleVarsVisible: true,
  sharedGlobals: false,
  typedParams: true,
  registry: DART_REGISTRY,
  clients: clients.clients as unknown as ClientSpec[],
  // `http.Request(method, uri)` / `http.MultipartRequest(...)`, with the headers and fields set on it afterwards; Dio
  // calls with the options and interceptors set on the instance after it is built
  detectors: [detectHttpRequest, detectDio],
  wildcardTypes: new Set(LIBRARY_NAMES),
  // Dio's `BaseOptions(...)` / `Options(...)` as dicts; `Uri.https(host, path, query)` as the URL it makes
  resolveCall: dartResolveCall,
  // a constructor's parameter given at the class's one construction, Riverpod provider reads, get_it lookups
  injection: DART_INJECTION,
  passthrough: {
    functions: new Set(["Uri.parse", "Uri.tryParse", "Uri.encodeFull", "Uri.encodeComponent", "Uri.encodeQueryComponent", "utf8.encode"]),
    methods: new Set(["toString", "trim", "toLowerCase", "toUpperCase"]),
  },
  serializers: { jsonEncode: "json", "json.encode": "json", "FormData.fromMap": "multipart" },
  manifests: pubManifests(),
  importRoots: (pkg) => [normalizePub(pkg)],
  normalizePackage: normalizePub,
};

export const dart = irLanguage(dartLanguage);
