import type { IrRegistryEntry } from "../../ir/language.js";
import anthropicJava from "./anthropic-java.json" with { type: "json" };
import awsBedrockRuntime from "./aws-bedrock-runtime.json" with { type: "json" };
import awsS3 from "./aws-s3.json" with { type: "json" };
import azureAiOpenai from "./azure-ai-openai.json" with { type: "json" };
import firebaseAdmin from "./firebase-admin.json" with { type: "json" };
import firebaseAndroid from "./firebase-android.json" with { type: "json" };
import firestore from "./firestore.json" with { type: "json" };
import googleGenai from "./google-genai.json" with { type: "json" };
import langchain4jAnthropic from "./langchain4j-anthropic.json" with { type: "json" };
import langchain4jBedrock from "./langchain4j-bedrock.json" with { type: "json" };
import langchain4jGemini from "./langchain4j-google-ai-gemini.json" with { type: "json" };
import langchain4jMistral from "./langchain4j-mistral-ai.json" with { type: "json" };
import langchain4jOllama from "./langchain4j-ollama.json" with { type: "json" };
import langchain4jOpenAi from "./langchain4j-open-ai.json" with { type: "json" };
import mailgunJava from "./mailgun-java.json" with { type: "json" };
import openaiJava from "./openai-java.json" with { type: "json" };
import openaiKotlin from "./openai-kotlin.json" with { type: "json" };
import posthogJava from "./posthog-java.json" with { type: "json" };
import posthog from "./posthog.json" with { type: "json" };
import resendJava from "./resend-java.json" with { type: "json" };
import sendgridJava from "./sendgrid-java.json" with { type: "json" };
import sentry from "./sentry.json" with { type: "json" };
import slackApiClient from "./slack-api-client.json" with { type: "json" };
import stripeJava from "./stripe-java.json" with { type: "json" };
import supabaseKt from "./supabase-kt.json" with { type: "json" };
import twilio from "./twilio.json" with { type: "json" };

/**
 * One set of keys for several clients (`variants`, each an entry of its own): Firestore's three JVM clients, the
 * Android Firebase and supabase-kt artifacts, a LangChain4j module's model classes.
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
  openaiKotlin,
  azureAiOpenai,
  anthropicJava,
  stripeJava,
  awsS3,
  awsBedrockRuntime,
  googleGenai,
  ...variants(firestore),
  firebaseAdmin,
  ...variants(firebaseAndroid),
  ...[langchain4jOpenAi, langchain4jAnthropic, langchain4jGemini, langchain4jMistral, langchain4jOllama, langchain4jBedrock].flatMap(variants),
  ...variants(supabaseKt),
  twilio,
  slackApiClient,
  sendgridJava,
  resendJava,
  mailgunJava,
  sentry,
  posthog,
  posthogJava,
] as unknown as IrRegistryEntry[];
