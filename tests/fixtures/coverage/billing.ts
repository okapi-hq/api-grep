import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_KEY!);

// the resource is picked at runtime: no call can be listed
export const listAny = (resource: string) => (stripe as unknown as Record<string, { list(): Promise<unknown> }>)[resource]!.list();
