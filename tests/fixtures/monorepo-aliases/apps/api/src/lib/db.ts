import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const db = createClient(process.env.HIVE_DB_URL ?? "", process.env.HIVE_DB_KEY ?? "");
export const billing = new Stripe(process.env.HIVE_STRIPE_KEY ?? "");
