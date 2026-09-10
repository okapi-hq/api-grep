import got from "got";

export function sendMail(email: string) {
  return got.post("https://api.sendgrid.com/v3/mail/send", {
    json: { personalizations: [{ to: [{ email }] }], from: { email: "noreply@example.com" }, subject: "Hello" },
    headers: { Authorization: `Bearer ${process.env.SENDGRID_KEY}` },
  });
}

export function items() {
  return got("https://api.example.com/items", { searchParams: { limit: 10, cursor: "abc" }, method: "GET" });
}

const mailgun = got.extend({ prefixUrl: "https://api.mailgun.net/v3", username: "api", password: process.env.MAILGUN_KEY });

export function mg(from: string, to: string) {
  return mailgun.post("example.com/messages", { form: { from, to, text: "hi" } });
}
