import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const welcome = (to: string) => resend.emails.send({ from: "Team <hello@example.com>", to, subject: "Welcome", html: "<p>Hi</p>" });

export const subscribe = (audienceId: string, email: string) => resend.contacts.create({ audienceId, email, unsubscribed: false });
