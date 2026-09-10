const BASE = "https://api.hubapi.com";

async function post(path: string, body: unknown) {
  return fetch(BASE + path, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } });
}

export const createContact = (email: string) => post("/crm/v3/objects/contacts", { properties: { email, lifecyclestage: "lead" } });
