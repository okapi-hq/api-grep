import type { IrLanguage, IrRegistryEntry, ClientSpec } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import { SHARED_EXCLUDES } from "../files.js";
import clients from "./clients.json" with { type: "json" };
import { lowerPython } from "./lower.js";
import { normalizePypi, pythonManifests } from "./manifests.js";
import modules from "./modules.json" with { type: "json" };
import { PYTHON_INJECTION } from "./depends.js";
import { settingsFieldEnv } from "./settings.js";
import { pythonConfigLoad } from "./config-load.js";
import { argparseDefault } from "./argparse.js";
import { detectUrllib } from "./urllib.js";
import { detectZeep } from "./zeep.js";
import { notebookPython } from "./notebook.js";
import { refineLangchainHuggingface } from "./langchain-huggingface.js";
import { refineOauthlib } from "./oauthlib.js";
import anthropicBedrock from "./registry/anthropic-bedrock.json" with { type: "json" };
import anthropicVertex from "./registry/anthropic-vertex.json" with { type: "json" };
import anthropic from "./registry/anthropic.json" with { type: "json" };
import { AWS_REGISTRY } from "./aws.js";
import cohereV2 from "./registry/cohere-v2.json" with { type: "json" };
import cohere from "./registry/cohere.json" with { type: "json" };
import convex from "./registry/convex.json" with { type: "json" };
import elevenlabs from "./registry/elevenlabs.json" with { type: "json" };
import replicate from "./registry/replicate.json" with { type: "json" };
import falClient from "./registry/fal-client.json" with { type: "json" };
import sendgrid from "./registry/sendgrid.json" with { type: "json" };
import mercadopago from "./registry/mercadopago.json" with { type: "json" };
import firebaseAdmin from "./registry/firebase-admin.json" with { type: "json" };
import googleCloudFirestore from "./registry/google-cloud-firestore.json" with { type: "json" };
import googleGenai from "./registry/google-genai.json" with { type: "json" };
import googleGenerativeai from "./registry/google-generativeai.json" with { type: "json" };
import groq from "./registry/groq.json" with { type: "json" };
import zhipuai from "./registry/zhipuai.json" with { type: "json" };
import zaiSdk from "./registry/zai-sdk.json" with { type: "json" };
import zaiSdkZhipu from "./registry/zai-sdk-zhipu.json" with { type: "json" };
import { sendgridMail } from "./sendgrid-mail.js";
import { sgqlcDocument } from "./sgqlc.js";
import gql from "./registry/gql.json" with { type: "json" };
import mcp from "./registry/mcp.json" with { type: "json" };
import fastmcp from "./registry/fastmcp.json" with { type: "json" };
import a2aSdk from "./registry/a2a-sdk.json" with { type: "json" };
import googleAdkA2a from "./registry/google-adk-a2a.json" with { type: "json" };
import strandsA2a from "./registry/strands-a2a.json" with { type: "json" };
import agentFrameworkA2a from "./registry/agent-framework-a2a.json" with { type: "json" };
import crewaiA2a from "./registry/crewai-a2a.json" with { type: "json" };
import fasta2a from "./registry/fasta2a.json" with { type: "json" };
import autogenExtMcp from "./registry/autogen-ext-mcp.json" with { type: "json" };
import claudeAgentSdkMcp from "./registry/claude-agent-sdk-mcp.json" with { type: "json" };
import crewaiMcp from "./registry/crewai-mcp.json" with { type: "json" };
import googleAdkMcp from "./registry/google-adk-mcp.json" with { type: "json" };
import langchainMcpAdapters from "./registry/langchain-mcp-adapters.json" with { type: "json" };
import llamaIndexToolsMcp from "./registry/llama-index-tools-mcp.json" with { type: "json" };
import openaiAgentsMcp from "./registry/openai-agents-mcp.json" with { type: "json" };
import pydanticAiMcp from "./registry/pydantic-ai-mcp.json" with { type: "json" };
import smolagentsMcp from "./registry/smolagents-mcp.json" with { type: "json" };
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
import { SLACK_BOLT } from "./slack-bolt.js";
import { MSGRAPH_REGISTRY, msgraphRequestConfiguration, msgraphSegment } from "./msgraph.js";
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
import pythonTelegramBot from "./registry/python-telegram-bot.json" with { type: "json" };
import aiogram from "./registry/aiogram.json" with { type: "json" };
import pyTelegramBotApi from "./registry/pytelegrambotapi.json" with { type: "json" };
import discordPy from "./registry/discord-py.json" with { type: "json" };
import huggingfaceHub from "./registry/huggingface-hub.json" with { type: "json" };
import claudeAgentSdk from "./registry/claude-agent-sdk.json" with { type: "json" };
import langchainDeepseek from "./registry/langchain-deepseek.json" with { type: "json" };
import langchainGoogleVertexai from "./registry/langchain-google-vertexai.json" with { type: "json" };
import langchainFireworks from "./registry/langchain-fireworks.json" with { type: "json" };
import langchainFireworksLlm from "./registry/langchain-fireworks-llm.json" with { type: "json" };
import langchainTogether from "./registry/langchain-together.json" with { type: "json" };
import langchainTogetherLlm from "./registry/langchain-together-llm.json" with { type: "json" };
import langchainHuggingface from "./registry/langchain-huggingface.json" with { type: "json" };
import googleCloudStorage from "./registry/google-cloud-storage.json" with { type: "json" };
import googleCloudSecretManager from "./registry/google-cloud-secret-manager.json" with { type: "json" };
import googleCloudBigquery from "./registry/google-cloud-bigquery.json" with { type: "json" };
import googleCloudAiplatform from "./registry/google-cloud-aiplatform.json" with { type: "json" };
import vertexai from "./registry/vertexai.json" with { type: "json" };
import vertexaiPreview from "./registry/vertexai-preview.json" with { type: "json" };
import vertexaiModels from "./registry/vertexai-models.json" with { type: "json" };
import pygithub from "./registry/pygithub.json" with { type: "json" };
import googleAuth from "./registry/google-auth.json" with { type: "json" };
import googleAuthOauthlib from "./registry/google-auth-oauthlib.json" with { type: "json" };
import googleApiPythonClient from "./registry/google-api-python-client.json" with { type: "json" };

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
  ...AWS_REGISTRY,
  twilio,
  slackSdk,
  SLACK_BOLT,
  resend,
  posthog,
  mistralai,
  groq,
  zhipuai,
  zaiSdk,
  zaiSdkZhipu,
  convex,
  cohere,
  cohereV2,
  elevenlabs,
  replicate,
  falClient,
  sendgrid,
  mercadopago,
  ...MSGRAPH_REGISTRY,
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
  mcp,
  fastmcp,
  a2aSdk,
  googleAdkA2a,
  strandsA2a,
  agentFrameworkA2a,
  crewaiA2a,
  fasta2a,
  shopify,
  web3,
  solana,
  // Telegram (generated by `pnpm gen:telegram`): one entry per object that sends requests
  ...pythonTelegramBot,
  ...aiogram,
  pyTelegramBotApi,
  ...discordPy,
  huggingfaceHub,
  claudeAgentSdk,
  langchainDeepseek,
  langchainGoogleVertexai,
  langchainFireworks,
  langchainFireworksLlm,
  langchainTogether,
  langchainTogetherLlm,
  langchainHuggingface,
  googleCloudStorage,
  googleCloudSecretManager,
  googleCloudBigquery,
  vertexai,
  vertexaiPreview,
  vertexaiModels,
  googleCloudAiplatform,
  pygithub,
  googleAuth,
  googleAuthOauthlib,
  ...googleApiPythonClient,
  // the MCP servers agent frameworks connect to: after the framework's own registry, which keeps its import roots
  langchainMcpAdapters,
  openaiAgentsMcp,
  claudeAgentSdkMcp,
  crewaiMcp,
  pydanticAiMcp,
  googleAdkMcp,
  smolagentsMcp,
  llamaIndexToolsMcp,
  autogenExtMcp,
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
  "**/.ipynb_checkpoints/**",
  "**/.tox/**",
  "**/.nox/**",
  "**/tests/**",
  "**/test/**",
  "**/integration_test/**",
  "**/integration_tests/**",
  "**/test_*.py",
  "**/*_test.py",
  "**/conftest.py",
];

export const pythonLanguage: IrLanguage = {
  id: "python",
  ecosystem: "pypi",
  grammar: "python",
  extensions: [".py", ".ipynb"],
  readText: (file, text) => (file.endsWith(".ipynb") ? notebookPython(text) : { text }),
  excludes: PYTHON_EXCLUDES,
  lower: lowerPython,
  moduleVarsVisible: true,
  sharedGlobals: false,
  registry: PYTHON_REGISTRY,
  clients: clients.clients as unknown as ClientSpec[],
  detectors: [detectUrllib, detectZeep],
  documentOf: sgqlcDocument,
  injection: PYTHON_INJECTION,
  fieldEnv: settingsFieldEnv,
  resolveCall: (call, fn, ctx) => pythonConfigLoad(call, fn, ctx) ?? sendgridMail(call, fn, ctx) ?? msgraphRequestConfiguration(call, fn, ctx),
  pathSegment: msgraphSegment,
  attrDefault: argparseDefault,
  refineSdk: (raw, _chain, ctx) => refineLangchainHuggingface(refineOauthlib(raw, ctx), ctx),
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
