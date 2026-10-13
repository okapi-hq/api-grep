import type { FrameworkEntry, RegistryEntry } from "../../types.js";
import anthropic from "./anthropic.json" with { type: "json" };
import awsBedrock from "./aws-sdk-v3-bedrock.json" with { type: "json" };
import convex from "./convex.json" with { type: "json" };
import googleGenAi from "./google-genai.json" with { type: "json" };
import googleGenerativeAi from "./google-generative-ai.json" with { type: "json" };
import lemonsqueezy from "./lemonsqueezy.json" with { type: "json" };
import mcp from "./mcp.json" with { type: "json" };
import posthogJs from "./posthog-js.json" with { type: "json" };
import posthogNode from "./posthog-node.json" with { type: "json" };
import resend from "./resend.json" with { type: "json" };
import revenuecat from "./revenuecat.json" with { type: "json" };
import frameworks from "./frameworks.json" with { type: "json" };
import awsS3 from "./aws-sdk-v3-s3.json" with { type: "json" };
import awsV2 from "./aws-sdk-v2.json" with { type: "json" };
import firebase from "./firebase.json" with { type: "json" };
import octokit from "./octokit.json" with { type: "json" };
import openai from "./openai.json" with { type: "json" };
import sentry from "./sentry.json" with { type: "json" };
import slack from "./slack.json" with { type: "json" };
import stripe from "./stripe.json" with { type: "json" };
import supabase from "./supabase.json" with { type: "json" };
import twilio from "./twilio.json" with { type: "json" };
import langchainOpenai from "./langchain-openai.json" with { type: "json" };
import langchainAnthropic from "./langchain-anthropic.json" with { type: "json" };
import langchainGoogleGenai from "./langchain-google-genai.json" with { type: "json" };
import langchainGroq from "./langchain-groq.json" with { type: "json" };
import langchainMistralai from "./langchain-mistralai.json" with { type: "json" };
import langchainOllama from "./langchain-ollama.json" with { type: "json" };
import langchainAws from "./langchain-aws.json" with { type: "json" };
import langchain from "./langchain.json" with { type: "json" };
import openaiAgents from "./openai-agents.json" with { type: "json" };
import groqSdk from "./groq-sdk.json" with { type: "json" };
import mistralai from "./mistralai.json" with { type: "json" };
import ollama from "./ollama.json" with { type: "json" };
import apolloClient from "./apollo-client.json" with { type: "json" };
import graphqlRequest from "./graphql-request.json" with { type: "json" };
import urql from "./urql.json" with { type: "json" };
import relay from "./relay.json" with { type: "json" };
import shopifyApi from "./shopify-api.json" with { type: "json" };
import shopifyAdminApiClient from "./shopify-admin-api-client.json" with { type: "json" };
import shopifyStorefrontApiClient from "./shopify-storefront-api-client.json" with { type: "json" };
import shopifyApiNode from "./shopify-api-node.json" with { type: "json" };
import solanaWeb3 from "./solana-web3.json" with { type: "json" };
import viem from "./viem.json" with { type: "json" };
import ethers from "./ethers.json" with { type: "json" };
import web3 from "./web3.json" with { type: "json" };

export class Registry {
  private byPkg = new Map<string, RegistryEntry>();
  readonly frameworks: FrameworkEntry[];

  constructor(entries: RegistryEntry[], frameworkEntries: FrameworkEntry[] = []) {
    for (const e of entries) this.add(e);
    this.frameworks = frameworkEntries;
  }

  add(e: RegistryEntry): void {
    this.byPkg.set(e.package, e);
    for (const a of e.aliases ?? []) this.byPkg.set(a, e);
  }

  /** Exact package first, then a scope wildcard alias (`@sentry/*`). */
  byPackage(pkg: string | undefined): RegistryEntry | undefined {
    if (!pkg) return undefined;
    const scope = pkg.startsWith("@") ? pkg.split("/")[0] : undefined;
    return this.byPkg.get(pkg) ?? (scope ? this.byPkg.get(`${scope}/*`) : undefined);
  }

  entries(): RegistryEntry[] {
    return [...new Set(this.byPkg.values())];
  }
}

export function defaultRegistry(): Registry {
  const entries: unknown[] = [stripe, openai, octokit, slack, twilio, awsS3, awsV2, supabase, firebase, sentry, anthropic, googleGenAi, googleGenerativeAi];
  entries.push(resend, revenuecat, lemonsqueezy, posthogJs, posthogNode, convex, awsBedrock, mcp);
  // model clients and agents
  entries.push(langchainOpenai, langchainAnthropic, langchainGoogleGenai, langchainGroq, langchainMistralai, langchainOllama, langchainAws, langchain, openaiAgents, groqSdk, mistralai, ollama);
  // GraphQL clients of any API (#54)
  entries.push(apolloClient, urql, graphqlRequest, relay);
  // Shopify's GraphQL clients (#67)
  entries.push(shopifyApi, shopifyAdminApiClient, shopifyStorefrontApiClient, shopifyApiNode);
  // JSON-RPC clients of any node (#52)
  entries.push(solanaWeb3, viem, ethers, web3);
  return new Registry(entries as RegistryEntry[], frameworks.frameworks as FrameworkEntry[]);
}
