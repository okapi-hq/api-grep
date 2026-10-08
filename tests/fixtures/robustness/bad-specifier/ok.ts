import { ping } from "./broken";

export async function status() {
  await ping();
  return fetch("https://api.github.com/rate_limit");
}
