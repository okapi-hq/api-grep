import { ServerClient } from "postmark";

const mail = new ServerClient(process.env.POSTMARK_TOKEN ?? "");

export const sendWelcome = (to: string) => mail.sendEmail({ From: "team@example.com", To: to, Subject: "Welcome", HtmlBody: "<p>Hello</p>" });
