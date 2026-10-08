import twilio from "twilio";

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

export const sms = (to: string, body: string) => client.messages.create({ to, from: "+15550000000", body });
