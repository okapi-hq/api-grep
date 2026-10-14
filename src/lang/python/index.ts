import type { IrLanguage, IrRegistryEntry, ClientSpec } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import { SHARED_EXCLUDES } from "../files.js";
import clients from "./clients.json" with { type: "json" };
import { lowerPython } from "./lower.js";
import { normalizePypi, pythonManifests } from "./manifests.js";
import modules from "./modules.json" with { type: "json" };
import { detectUrllib } from "./urllib.js";
import { detectZeep } from "./zeep.js";
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
import { sgqlcDocument } from "./sgqlc.js";
import gql from "./registry/gql.json" with { type: "json" };
import sgqlc from "./registry/sgqlc.json" with { type: "json" };
import shopify from "./registry/shopify.json" with { type: "json" };
import solana from "./registry/solana.json" with { type: "json" };
import web3 from "./registry/web3.json" with { type: "json" };
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
import langchainOpenai from "./registry/langchain-openai.json" with { type: "json" };
import langchainAnthropic from "./registry/langchain-anthropic.json" with { type: "json" };
import langchainGoogleGenai from "./registry/langchain-google-genai.json" with { type: "json" };
import langchainGroq from "./registry/langchain-groq.json" with { type: "json" };
import langchainMistralai from "./registry/langchain-mistralai.json" with { type: "json" };
import langchainOllama from "./registry/langchain-ollama.json" with { type: "json" };
import langchainAws from "./registry/langchain-aws.json" with { type: "json" };
import langchain from "./registry/langchain.json" with { type: "json" };
import llamaIndexOpenai from "./registry/llama-index-llms-openai.json" with { type: "json" };
import llamaIndexAnthropic from "./registry/llama-index-llms-anthropic.json" with { type: "json" };
import litellm from "./registry/litellm.json" with { type: "json" };
import pydanticAi from "./registry/pydantic-ai.json" with { type: "json" };
import openaiAgents from "./registry/openai-agents.json" with { type: "json" };
import crewai from "./registry/crewai.json" with { type: "json" };
import dspy from "./registry/dspy.json" with { type: "json" };
import smolagents from "./registry/smolagents.json" with { type: "json" };
import instructor from "./registry/instructor.json" with { type: "json" };
import autogenExt from "./registry/autogen-ext.json" with { type: "json" };
import googleAdk from "./registry/google-adk.json" with { type: "json" };
import ollama from "./registry/ollama.json" with { type: "json" };

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
  langchainOpenai,
  langchainAnthropic,
  langchainGoogleGenai,
  langchainGroq,
  langchainMistralai,
  langchainOllama,
  langchainAws,
  langchain,
  llamaIndexOpenai,
  llamaIndexAnthropic,
  litellm,
  pydanticAi,
  openaiAgents,
  crewai,
  dspy,
  smolagents,
  instructor,
  autogenExt,
  googleAdk,
  ollama,
  gql,
  sgqlc,
  shopify,
  web3,
  solana,
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
  detectors: [detectUrllib, detectZeep],
  documentOf: sgqlcDocument,
  passthrough: {
    // `gql("query ...")` (the gql package) parses a document: its value is the text
    functions: new Set(["str", "quote", "quote_plus", "unquote", "escape", "gql"]),
    methods: new Set(["strip", "rstrip", "lstrip", "lower", "upper", "casefold", "encode", "decode", "removesuffix"]),
  },
  serializers: {
    "json.dumps": "json",
    "orjson.dumps": "json",
    "ujson.dumps": "json",
    dumps: "json",
    urlencode: "form",
    "ET.tostring": "xml",
    "etree.tostring": "xml",
    "ElementTree.tostring": "xml",
    "xmltodict.unparse": "xml",
    toxml: "xml",
    toprettyxml: "xml",
  },
  manifests: pythonManifests(),
  importRoots,
  normalizePackage: normalizePypi,
};

export const python = irLanguage(pythonLanguage);
