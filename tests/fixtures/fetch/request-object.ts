export function send(to: string) {
  return fetch(new Request("https://api.resend.com/emails", { method: "POST", body: JSON.stringify({ to, from: "me@example.com", subject: "hi" }) }));
}
