import { SHARED_EXCLUDES } from "../files.js";
import type { ClientSpec, IrLanguage, IrRegistryEntry } from "../ir/language.js";
import { irLanguage } from "../ir/scan.js";
import clients from "./clients.json" with { type: "json" };
import { laravelConfig } from "./config.js";
import { detectCurl } from "./curl.js";
import { lowerPhp } from "./lower.js";
import { normalizeComposer, phpManifests } from "./manifests.js";
import namespaces from "./namespaces.json" with { type: "json" };
import { detectPsrRequest } from "./psr.js";
import { detectStream } from "./streams.js";
import anthropicSdkPhp from "./registry/anthropic-sdk-php.json" with { type: "json" };
import awsBedrockRuntime from "./registry/aws-bedrock-runtime.json" with { type: "json" };
import awsS3 from "./registry/aws-s3.json" with { type: "json" };
import geminiPhp from "./registry/gemini-php.json" with { type: "json" };
import googleCloudFirestore from "./registry/google-cloud-firestore.json" with { type: "json" };
import kreaitFirebase from "./registry/kreait-firebase.json" with { type: "json" };
import mailgunPhp from "./registry/mailgun-php.json" with { type: "json" };
import mozexAnthropicPhp from "./registry/mozex-anthropic-php.json" with { type: "json" };
import openaiPhp from "./registry/openai-php.json" with { type: "json" };
import posthogPhp from "./registry/posthog-php.json" with { type: "json" };
import resendPhp from "./registry/resend-php.json" with { type: "json" };
import sendgridPhp from "./registry/sendgrid-php.json" with { type: "json" };
import sentryPhp from "./registry/sentry-php.json" with { type: "json" };
import slackPhpApi from "./registry/slack-php-api.json" with { type: "json" };
import stripePhp from "./registry/stripe-php.json" with { type: "json" };
import twilioPhp from "./registry/twilio-php.json" with { type: "json" };

/** Registries sharing an import root are told apart by their instance names (`Aws.S3` / `Aws.BedrockRuntime`). */
export const PHP_REGISTRY = [
  stripePhp,
  openaiPhp,
  anthropicSdkPhp,
  mozexAnthropicPhp,
  geminiPhp,
  awsS3,
  awsBedrockRuntime,
  twilioPhp,
  kreaitFirebase,
  googleCloudFirestore,
  sentryPhp,
  resendPhp,
  posthogPhp,
  sendgridPhp,
  mailgunPhp,
  slackPhpApi,
] as unknown as IrRegistryEntry[];

const NAMESPACES: Record<string, string[]> = namespaces.namespaces;

/** Root namespaces of a Composer package, from its autoload (a Laravel bridge has its own, not its SDK's). */
function importRoots(pkg: string): string[] {
  return NAMESPACES[pkg] ?? PHP_REGISTRY.find((r) => r.package === pkg)?.imports ?? [];
}

export const PHP_EXCLUDES = [
  ...SHARED_EXCLUDES,
  "**/vendor/**",
  "**/tests/**",
  "**/Tests/**",
  "**/test/**",
  "**/*Test.php",
  "**/storage/**",
  "**/bootstrap/cache/**",
  "**/var/cache/**",
  "**/*.blade.php",
];

export const phpLanguage: IrLanguage = {
  id: "php",
  ecosystem: "composer",
  grammar: "php",
  extensions: [".php"],
  excludes: PHP_EXCLUDES,
  lower: lowerPhp,
  moduleVarsVisible: false,
  sharedGlobals: true,
  registry: PHP_REGISTRY,
  clients: clients.clients as unknown as ClientSpec[],
  detectors: [detectCurl, detectStream, detectPsrRequest],
  resolveCall: laravelConfig,
  passthrough: {
    functions: new Set(["trim", "rtrim", "ltrim", "strtolower", "strtoupper", "urlencode", "rawurlencode", "strval", "url"]),
    methods: new Set([]),
  },
  serializers: { json_encode: "json", http_build_query: "form" },
  manifests: phpManifests(),
  importRoots,
  normalizePackage: normalizeComposer,
};

export const php = irLanguage(phpLanguage);
