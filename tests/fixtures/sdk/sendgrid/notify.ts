import sgMail, { MailService } from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendWelcome(address: string, firstName: string) {
  await sgMail.send({ to: address, from: { email: "hello@harbor-tide.test", name: "Harbor Tide" }, templateId: "d-8c2f4a1b9e7d4c3a", dynamicTemplateData: { firstName } });
}

export async function sendReceipt(address: string, total: number) {
  const msg = { to: [address], from: "billing@harbor-tide.test", subject: "Your receipt", text: `Total: ${total}`, html: `<p>Total: ${total}</p>`, isMultiple: false };
  return sgMail.send(msg);
}

export async function sendAlerts(addresses: string[]) {
  return sgMail.sendMultiple({ to: addresses, from: "alerts@harbor-tide.test", subject: "Status", text: "All systems normal", mail_settings: { sandbox_mode: { enable: true } } });
}

const transactional = new MailService();
transactional.setApiKey(process.env.SENDGRID_TX_KEY!);

export async function sendBatch(addresses: string[]) {
  return transactional.send(addresses.map((to) => ({ to, from: "news@harbor-tide.test", subject: "News", html: "<p>Hi</p>" })));
}
