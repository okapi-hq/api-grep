import emailjs from "emailjs-com";

export function sendFeedback(text) {
  return emailjs.send("service_meadow", "template_feedback", { text }, "user_meadowlark");
}
