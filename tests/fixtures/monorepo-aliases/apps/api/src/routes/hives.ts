import { billing, db } from "@/lib/db";

export async function listHives(token: string) {
  const { data: user } = await db.auth.getUser(token);
  const { data } = await db.from("hives").select("*").eq("owner", user.user?.id);
  return data;
}

export async function subscribe(customer: string) {
  return billing.subscriptions.create({ customer, items: [{ price: "price_honey_monthly" }] });
}
