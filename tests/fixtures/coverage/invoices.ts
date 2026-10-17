import { Stripe } from "stripe";

// `Stripe` only names types here: the compiler drops the import, so the package is not loaded
export type Invoice = Stripe.Invoice;

export function totalOf(invoice: Stripe.Invoice): number {
  return invoice.total;
}
