import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const url = process.env.GARDEN_DB_URL;
const key = process.env.GARDEN_DB_KEY;

// built only when configured: the other branch is no client at all
export const db = url && key ? createClient(url, key) : null;
const mailer = process.env.GARDEN_MAIL_KEY ? new Resend(process.env.GARDEN_MAIL_KEY) : undefined;
const cached = (globalThis as { gardenDb?: ReturnType<typeof createClient> }).gardenDb ?? createClient("https://plots.supabase.co", "anon");

export async function listBeds() {
  if (!db) return [];
  const { data } = await db.from("beds").select("*");
  return data;
}

export async function remind(to: string) {
  await mailer?.emails.send({ from: "garden@example.com", to, subject: "Water the beds", html: "<p>Now</p>" });
}

export async function seeds() {
  return cached.from("seeds").select("name");
}
