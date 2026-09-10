import { hubspot } from "./client";

export function getContact(id: string) {
  return hubspot.get(`/crm/v3/objects/contacts/${id}`);
}
