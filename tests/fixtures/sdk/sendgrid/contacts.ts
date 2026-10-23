import client from "@sendgrid/client";

client.setApiKey(process.env.SENDGRID_API_KEY!);

export async function addContact(address: string, listId: string) {
  return client.request({ method: "PUT", url: "/v3/marketing/contacts", body: { list_ids: [listId], contacts: [{ email: address }] } });
}

export async function templates() {
  return client.request({ url: "/v3/templates", qs: { generations: "dynamic", page_size: 20 } });
}

export async function removeBounce(address: string) {
  return client.request({ method: "DELETE", url: `/v3/suppression/bounces/${address}` });
}
