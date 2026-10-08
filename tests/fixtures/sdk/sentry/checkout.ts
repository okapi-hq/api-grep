import { captureException } from "@sentry/nextjs";
import { reportError } from "./monitoring";

export async function pay(amount: number) {
  try {
    return await Promise.resolve(amount);
  } catch (err) {
    captureException(err, { tags: { area: "checkout" } });
    throw err;
  }
}

export function onRefundFailed(err: Error) {
  reportError(err);
}
