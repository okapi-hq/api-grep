import { send } from "@emailjs/nodejs";

export async function alertOps(summary: string) {
  return send(process.env.EMAILJS_SERVICE!, "template_alert", { summary, severity: "high" }, { publicKey: process.env.EMAILJS_PUBLIC!, privateKey: process.env.EMAILJS_PRIVATE! });
}
