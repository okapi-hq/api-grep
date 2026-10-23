import { BrevoClient } from "@getbrevo/brevo";

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

export const notify = (to: string) =>
  brevo.transactionalEmails.sendTransacEmail({ subject: "Your export is ready", sender: { email: "ops@lanternfold.example" }, to: [{ email: to }], textContent: "Done." });

export const profile = (email: string) => brevo.contacts.getContactInfo({ identifier: email, identifierType: "email_id" });

export const tag = (email: string) => brevo.contacts.updateContact({ identifier: email, identifierType: "email_id", attributes: { PLAN: "pro" } });

export const join = (listId: number, email: string) => brevo.contacts.addContactToList({ listId, emails: [email] });

export const recent = () => brevo.contacts.getContacts({ limit: 10, sort: "desc" });
