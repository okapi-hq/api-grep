import * as Sentry from "@sentry/react";

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });

export function reportError(error: unknown) {
  Sentry.captureException(error);
}

export const warn = (message: string) => Sentry.captureMessage(message, "warning");
