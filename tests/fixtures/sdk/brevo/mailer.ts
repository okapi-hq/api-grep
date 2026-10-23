import * as brevo from "@getbrevo/brevo";

const emails = new brevo.TransactionalEmailsApi();
emails.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY ?? "");

export async function sendWelcome(to: string, name: string) {
  const email = new brevo.SendSmtpEmail();
  email.subject = "Welcome to Lanternfold";
  email.sender = { name: "Lanternfold", email: "hello@lanternfold.example" };
  email.to = [{ email: to, name }];
  email.htmlContent = "<p>Hi there</p>";
  return emails.sendTransacEmail(email);
}

export const sendReceipt = (to: string, orderId: string) =>
  emails.sendTransacEmail({ templateId: 12, to: [{ email: to }], params: { orderId } });

const contacts = new brevo.ContactsApi();
contacts.setApiKey(brevo.ContactsApiApiKeys.apiKey, process.env.BREVO_API_KEY ?? "");

export const subscribe = (email: string, listId: number) => contacts.createContact({ email, listIds: [listId], updateEnabled: true });

export const rename = (email: string, firstName: string) => contacts.updateContact(email, { attributes: { FIRSTNAME: firstName } });

export const addToList = (listId: number, email: string) => contacts.addContactToList(listId, { emails: [email] });

export const page = () => contacts.getContacts(50, 0);

const sms = new brevo.TransactionalSMSApi();

export const textCode = (recipient: string, code: string) => sms.sendTransacSms({ sender: "Lantern", recipient, content: `Your code: ${code}` });
