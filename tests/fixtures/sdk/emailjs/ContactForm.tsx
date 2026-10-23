import { useRef } from "react";
import emailjs from "@emailjs/browser";

emailjs.init({ publicKey: "pk_meadowlark_demo" });

export function ContactForm() {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => emailjs.sendForm("service_meadow", "template_contact", form.current!);
  return <form ref={form} onSubmit={submit} />;
}

export const sendQuote = (name: string, email: string, message: string) =>
  emailjs.send("service_meadow", "template_quote", { from_name: name, reply_to: email, message }, { publicKey: "pk_meadowlark_demo" });
