import Stripe from "stripe";

const stripe = new Stripe("sk_test_placeholder");

declare function buildParams(): Stripe.CustomerCreateParams;

export function create() {
  const params = buildParams();
  return stripe.customers.create(params);
}

export function update(subId: string, base: Stripe.SubscriptionUpdateParams) {
  return stripe.subscriptions.update(subId, { ...base, cancel_at_period_end: true });
}
