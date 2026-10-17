import * as Sentry from "@sentry/react";
import { PostHog } from "posthog-node";

export function startMonitoring(dsn: string) {
  Sentry.init({ dsn });
}

export const analytics = new PostHog(process.env.KILN_POSTHOG_KEY ?? "", { host: "https://eu.i.posthog.com" });

// the SDK handed on under the module's own name
export { Sentry };
export default analytics;
