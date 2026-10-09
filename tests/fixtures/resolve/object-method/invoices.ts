import { booksCommon } from "./common";

export function listInvoices(env: "production" | "sandbox") {
  return fetch(`${booksCommon.getApiUrl(env)}/invoices`);
}

export function token(realm: string) {
  return fetch(booksCommon.tokenUrl(realm), { method: "POST" });
}

// a stray leading space does not make the URL relative
export function call() {
  return fetch(" https://api.example-voice.com/call", { method: "POST" });
}
