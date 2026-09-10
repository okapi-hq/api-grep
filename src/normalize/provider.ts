import type { HostKind } from "../types.js";

/** Host suffix (or exact host) -> provider. Suffixes start with a dot. */
const HOSTS: [string, string][] = [
  ["api.stripe.com", "stripe"],
  ["files.stripe.com", "stripe"],
  ["connect.stripe.com", "stripe"],
  ["api.openai.com", "openai"],
  ["api.anthropic.com", "anthropic"],
  ["generativelanguage.googleapis.com", "google-ai"],
  [".googleapis.com", "google"],
  [".amazonaws.com", "aws"],
  ["api.github.com", "github"],
  ["github.com", "github"],
  [".github.com", "github"],
  ["hooks.slack.com", "slack"],
  ["slack.com", "slack"],
  [".slack.com", "slack"],
  ["api.twilio.com", "twilio"],
  [".twilio.com", "twilio"],
  ["api.sendgrid.com", "sendgrid"],
  ["api.resend.com", "resend"],
  ["api.mailgun.net", "mailgun"],
  ["api.postmarkapp.com", "postmark"],
  ["api.notion.com", "notion"],
  ["api.linear.app", "linear"],
  ["api.hubapi.com", "hubspot"],
  [".salesforce.com", "salesforce"],
  ["api.vercel.com", "vercel"],
  ["api.cloudflare.com", "cloudflare"],
  ["api.zoom.us", "zoom"],
  ["graph.microsoft.com", "microsoft"],
  ["login.microsoftonline.com", "microsoft"],
  ["oauth2.googleapis.com", "google"],
  ["www.googleapis.com", "google"],
  ["api.mistral.ai", "mistral"],
  ["api.groq.com", "groq"],
  ["openrouter.ai", "openrouter"],
  ["api.telegram.org", "telegram"],
  ["discord.com", "discord"],
  ["api.intercom.io", "intercom"],
  ["api.segment.io", "segment"],
  ["api.mixpanel.com", "mixpanel"],
  ["app.posthog.com", "posthog"],
  [".posthog.com", "posthog"],
  ["api.airtable.com", "airtable"],
  ["api.dub.co", "dub"],
  ["api.cal.com", "cal"],
  ["api.paddle.com", "paddle"],
  ["api.lemonsqueezy.com", "lemonsqueezy"],
  ["api.supabase.com", "supabase"],
  [".supabase.co", "supabase"],
  ["api.clerk.com", "clerk"],
  ["api.algolia.net", "algolia"],
  [".algolia.net", "algolia"],
  ["api.unsplash.com", "unsplash"],
  ["api.giphy.com", "giphy"],
  ["api.mapbox.com", "mapbox"],
  ["maps.googleapis.com", "google-maps"],
  ["api.pagerduty.com", "pagerduty"],
  ["sentry.io", "sentry"],
  ["api.datadoghq.com", "datadog"],
  ["registry.npmjs.org", "npm"],
  ["api.exchangerate.host", "exchangerate"],
];

export function providerForHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  for (const [pattern, provider] of HOSTS) {
    if (pattern.startsWith(".") ? h.endsWith(pattern) : h === pattern) return provider;
  }
  return undefined;
}

export interface ProviderInput {
  hostKind: HostKind;
  host?: string;
  envName?: string;
  sdkProvider?: string;
}

export function inferProvider(input: ProviderInput): string {
  if (input.sdkProvider) return input.sdkProvider;
  if (input.hostKind === "relative" || isLocalhost(input.host)) return "internal";
  const known = providerForHost(input.host);
  if (known) return known;
  if (input.hostKind === "env") return input.host ?? `env:${input.envName ?? "?"}`;
  if (input.host) return input.host;
  return "unknown";
}

export function isLocalhost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.replace(/:\d+$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".local");
}
