import { db } from "@/lib/db";

export async function cachedHives() {
  return db.from("hives").select("*");
}

export async function fromApi() {
  const res = await fetch("/api/hives");
  return res.json();
}
