import Stripe from "stripe";

export class Billing {
  private stripe = new Stripe(process.env.STRIPE_KEY!);

  async charge(customer: string) {
    return this.stripe.paymentIntents.create({ amount: 500, currency: "usd", customer });
  }
}

export class Injected {
  constructor(private readonly stripe: Stripe) {}

  balance() {
    return this.stripe.balance.retrieve();
  }
}
