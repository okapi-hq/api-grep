import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

class LocalStore {
  from(table: string) {
    return { select: (cols: string) => Promise.resolve({ table, cols }) };
  }
}

// a guard around the app's own class: no SDK client
const store = process.env.OFFLINE ? new LocalStore() : null;
// two clients, picked at run time: neither is the one the code calls
const either = process.env.MIRROR ? createClient("https://mirror-a.supabase.co", "k") : new LocalStore();
// a client the caller may hand in, else the app's own
const fallback = (given?: SupabaseClient) => given ?? new LocalStore();

export async function load() {
  await store?.from("plots").select("*");
  await (either as LocalStore).from("plots").select("*");
  return fallback().from("plots").select("*");
}
