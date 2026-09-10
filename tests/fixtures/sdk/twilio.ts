import twilio from "twilio";

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const serviceSid = process.env.TWILIO_VERIFY_SID;

export const sms = (to: string, body: string) => client.messages.create({ to, from: "+15550000000", body });
export const verify = (to: string) => client.verify.v2.services(serviceSid).verifications.create({ to, channel: "sms" });
