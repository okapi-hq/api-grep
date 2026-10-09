import type { IrLanguage, IrRegistryEntry, ClientSpec } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import { SHARED_EXCLUDES } from "../files.js";
import clients from "./clients.json" with { type: "json" };
import { lowerPython } from "./lower.js";
import { normalizePypi, pythonManifests } from "./manifests.js";
import modules from "./modules.json" with { type: "json" };
import { detectUrllib } from "./urllib.js";
import anthropicBedrock from "./registry/anthropic-bedrock.json" with { type: "json" };
import anthropicVertex from "./registry/anthropic-vertex.json" with { type: "json" };
import anthropic from "./registry/anthropic.json" with { type: "json" };
import boto3Bedrock from "./registry/boto3-bedrock.json" with { type: "json" };
import boto3S3 from "./registry/boto3-s3.json" with { type: "json" };
import cohereV2 from "./registry/cohere-v2.json" with { type: "json" };
import cohere from "./registry/cohere.json" with { type: "json" };
import convex from "./registry/convex.json" with { type: "json" };
import elevenlabs from "./registry/elevenlabs.json" with { type: "json" };
import firebaseAdmin from "./registry/firebase-admin.json" with { type: "json" };
import googleCloudFirestore from "./registry/google-cloud-firestore.json" with { type: "json" };
import googleGenai from "./registry/google-genai.json" with { type: "json" };
import googleGenerativeai from "./registry/google-generativeai.json" with { type: "json" };
import groq from "./registry/groq.json" with { type: "json" };
import mistralai from "./registry/mistralai.json" with { type: "json" };
import openaiAzure from "./registry/openai-azure.json" with { type: "json" };
import openai from "./registry/openai.json" with { type: "json" };
import posthog from "./registry/posthog.json" with { type: "json" };
import resend from "./registry/resend.json" with { type: "json" };
import sentrySdk from "./registry/sentry-sdk.json" with { type: "json" };
import slackSdk from "./registry/slack-sdk.json" with { type: "json" };
import stripe from "./registry/stripe.json" with { type: "json" };
import supabase from "./registry/supabase.json" with { type: "json" };
import twilio from "./registry/twilio.json" with { type: "json" };

/** Registries sharing an import root are told apart by their instance names; module-level calls (`openai.chat...`) go to the first one. */
export const PYTHON_REGISTRY = [
  stripe,
  openai,
  openaiAzure,
  anthropic,
  anthropicBedrock,
  anthropicVertex,
  googleGenai,
  googleGenerativeai,
  supabase,
  firebaseAdmin,
  googleCloudFirestore,
  sentrySdk,
  boto3S3,
  boto3Bedrock,
  twilio,
  slackSdk,
  resend,
  posthog,
  mistralai,
  groq,
  convex,
  cohere,
  cohereV2,
  elevenlabs,
] as unknown as IrRegistryEntry[];

const MODULES: Record<string, string[]> = modules.modules;

/** Import roots of a PyPI distribution: its registry's, a known exception, else the name with `_` for `-`. */
function importRoots(pkg: string): string[] {
  const reg = PYTHON_REGISTRY.find((r) => r.package === pkg || r.aliases?.includes(pkg));
  if (reg) return reg.imports;
  return MODULES[pkg] ?? [normalizePypi(pkg).replace(/-/g, "_")];
}

export const PYTHON_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/.venv/**",
  "**/venv/**",
  "**/site-packages/**",
  "**/__pycache__/**",
  "**/.tox/**",
  "**/.nox/**",
  "**/tests/**",
  "**/test/**",
  "**/test_*.py",
  "**/*_test.py",
  "**/conftest.py",
];

export const pythonLanguage: IrLanguage = {
  id: "python",
  ecosystem: "pypi",
  grammar: "python",
  extensions: [".py"],
  excludes: PYTHON_EXCLUDES,
  lower: lowerPython,
  moduleVarsVisible: true,
  sharedGlobals: false,
  registry: PYTHON_REGISTRY,
  clients: clients.clients as unknown as ClientSpec[],
  detectors: [detectUrllib],
  passthrough: {
    functions: new Set(["str", "quote", "quote_plus", "unquote", "escape"]),
    methods: new Set(["strip", "rstrip", "lstrip", "lower", "upper", "casefold", "encode", "decode", "removesuffix"]),
  },
  serializers: { "json.dumps": "json", "orjson.dumps": "json", "ujson.dumps": "json", dumps: "json", urlencode: "form" },
  manifests: pythonManifests(),
  importRoots,
  normalizePackage: normalizePypi,
};

export const python = irLanguage(pythonLanguage);
