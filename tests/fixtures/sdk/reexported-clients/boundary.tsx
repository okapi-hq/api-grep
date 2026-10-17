import { Sentry } from "./monitoring";

export function reportGlaze(error: Error) {
  Sentry.captureException(error, { extra: { where: "glaze-form" } });
}
