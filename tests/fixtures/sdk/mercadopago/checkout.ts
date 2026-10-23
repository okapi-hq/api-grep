import MercadoPagoConfig, { Customer, Order, Payment, PaymentRefund, PreApproval, Preference } from "mercadopago";

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN ?? "", options: { timeout: 5000 } });
const preferences = new Preference(client);
const payments = new Payment(client);

export async function checkout(title: string, price: number) {
  const pref = await preferences.create({ body: { items: [{ id: "sku-1", title, quantity: 1, unit_price: price }], back_urls: { success: "https://tidepool.example/ok" } } });
  return pref.init_point;
}

export const pay = (token: string, amount: number, email: string) =>
  payments.create({ body: { transaction_amount: amount, token, installments: 1, payer: { email } }, requestOptions: { idempotencyKey: "tp-1" } });

export const status = (id: string) => payments.get({ id });

export const approved = () => payments.search({ options: { status: "approved", limit: 20 } });

export const cancel = (id: string) => payments.cancel({ id });

export const refund = (paymentId: number, amount: number) => new PaymentRefund(client).create({ payment_id: paymentId, body: { amount } });

export const shopper = (customerId: string) => new Customer(client).update({ customerId, body: { phone: { area_code: "11", number: "555" } } });

export const subscribe = (email: string) => new PreApproval(client).create({ body: { reason: "Tidepool Plus", payer_email: email } });

export const capture = (id: string) => new Order(client).capture({ id });
