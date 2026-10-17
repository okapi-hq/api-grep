import * as brevo from "@getbrevo/brevo";

const mail = new brevo.TransactionalEmailsApi();

export const sendWelcome = (to: string) =>
  mail.sendTransacEmail({ to: [{ email: to }], subject: "Welcome", htmlContent: "<p>Hello</p>", sender: { email: "team@example.com" } });
