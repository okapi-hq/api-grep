import { cancelSubscription, createCheckout, getSubscription, lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";

lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY });

export const checkout = (storeId: number, variantId: number, email: string) => createCheckout(storeId, variantId, { checkoutData: { email } });

export const subscription = (id: string) => getSubscription(id);

export const cancel = (id: string) => cancelSubscription(id);
