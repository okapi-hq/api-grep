import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { api_host: "https://eu.i.posthog.com" });

export const trackSignup = (plan: string) => posthog.capture("signed_up", { plan });

export const identify = (userId: string) => posthog.identify(userId);

// a local read: no request
export const flag = () => posthog.isFeatureEnabled("new-onboarding");
