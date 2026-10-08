import { PostHog } from "posthog-node";

const client = new PostHog(process.env.POSTHOG_KEY!, { host: "https://eu.i.posthog.com" });

export const trackServer = (distinctId: string) => client.capture({ distinctId, event: "invoice_paid" });

export const flagFor = (distinctId: string) => client.isFeatureEnabled("beta-export", distinctId);
