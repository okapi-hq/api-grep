import { CONFIG } from "./config";

export function checkLicense(key: string) {
  return fetch(CONFIG.license.endpoint, { method: "POST", body: JSON.stringify({ key }) });
}

export function listContacts(token: string) {
  return fetch(CONFIG.mail.baseUrl + "/contacts", { headers: { authorization: `Bearer ${token}` } });
}
