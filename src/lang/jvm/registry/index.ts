import type { IrRegistryEntry } from "../../ir/language.js";
import anthropicJava from "./anthropic-java.json" with { type: "json" };
import awsBedrockRuntime from "./aws-bedrock-runtime.json" with { type: "json" };
import awsS3 from "./aws-s3.json" with { type: "json" };
import firebaseAdmin from "./firebase-admin.json" with { type: "json" };
import firestore from "./firestore.json" with { type: "json" };
import googleGenai from "./google-genai.json" with { type: "json" };
import openaiJava from "./openai-java.json" with { type: "json" };
import posthogJava from "./posthog-java.json" with { type: "json" };
import posthog from "./posthog.json" with { type: "json" };
import sentry from "./sentry.json" with { type: "json" };
import slackApiClient from "./slack-api-client.json" with { type: "json" };
import stripeJava from "./stripe-java.json" with { type: "json" };
import twilio from "./twilio.json" with { type: "json" };

/** Firestore's keys are the same for its three JVM clients: one entry per client package. */
function firestoreEntries(): unknown[] {
  const { variants, ...shared } = firestore;
  return variants.map((v) => ({ ...shared, ...v }));
}

/**
 * SDK registries of the JVM, keyed by Maven coordinates and fully qualified class names: Kotlin reads them today and
 * Java (#43) will read the same ones. Entries that share a class are told apart by their instance names.
 */
export const JVM_REGISTRY = [
  openaiJava,
  anthropicJava,
  stripeJava,
  awsS3,
  awsBedrockRuntime,
  googleGenai,
  ...firestoreEntries(),
  firebaseAdmin,
  twilio,
  slackApiClient,
  sentry,
  posthog,
  posthogJava,
] as unknown as IrRegistryEntry[];
