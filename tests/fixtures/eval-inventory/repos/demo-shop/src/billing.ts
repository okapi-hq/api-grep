import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function openAccount(email: string) {
  return stripe.customers.create({ email });
}
