import { createServerClient } from "@supabase/ssr";

export function createClient() {
  return createServerClient("https://abcdefgh.supabase.co", "public-anon-key", { cookies: { getAll: () => [] } });
}

export async function invoices() {
  const client = createClient();
  return client.from("invoices").select("*").order("created_at");
}

export const latest = () => createClient().from("invoices").select("id").limit(1);
