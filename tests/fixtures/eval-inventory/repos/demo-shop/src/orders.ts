import { supabase } from "./db";

export async function listOrders() {
  const { data } = await supabase.from("orders").select("id, total");
  return data;
}

export async function addOrder(total: number) {
  return supabase.from("orders").insert({ total });
}

export async function overview() {
  const [orders, items] = await Promise.all([supabase.from("orders").select("*"), supabase.from("items").select("id")]);
  return { orders, items };
}
