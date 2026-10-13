import type { IrRegistryEntry } from "../../ir/language.js";
import anthropicJava from "./anthropic-java.json" with { type: "json" };
import awsBedrockRuntime from "./aws-bedrock-runtime.json" with { type: "json" };
import awsDynamodbEnhanced from "./aws-dynamodb-enhanced.json" with { type: "json" };
import awsDynamodb from "./aws-dynamodb.json" with { type: "json" };
import awsJavaSdkS3 from "./aws-java-sdk-s3.json" with { type: "json" };
import awsS3TransferManager from "./aws-s3-transfer-manager.json" with { type: "json" };
import awsS3 from "./aws-s3.json" with { type: "json" };
import awsSes from "./aws-ses.json" with { type: "json" };
import awsSesv2 from "./aws-sesv2.json" with { type: "json" };
import awsSns from "./aws-sns.json" with { type: "json" };
import awsSqs from "./aws-sqs.json" with { type: "json" };
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

/**
 * One set of keys for several clients (`variants`, each an entry of its own package): Firestore's three JVM clients,
 * an AWS service's Java 2.x and Kotlin SDKs.
 */
function variants(file: object): unknown[] {
  const { variants: list, ...shared } = file as { variants: object[] };
  return list.map((v) => ({ ...shared, ...v }));
}

/**
 * SDK registries of the JVM, keyed by Maven coordinates and fully qualified class names, read by the Kotlin and Java
 * front end. Entries that share a class are told apart by their instance names.
 */
export const JVM_REGISTRY = [
  openaiJava,
  anthropicJava,
  stripeJava,
  ...[awsS3, awsBedrockRuntime, awsDynamodb, awsSqs, awsSns, awsSes, awsSesv2].flatMap(variants),
  awsDynamodbEnhanced,
  awsS3TransferManager,
  awsJavaSdkS3,
  googleGenai,
  ...variants(firestore),
  firebaseAdmin,
  twilio,
  slackApiClient,
  sentry,
  posthog,
  posthogJava,
] as unknown as IrRegistryEntry[];
