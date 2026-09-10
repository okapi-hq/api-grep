import fetch from "node-fetch";

export function notify(text: string) {
  return fetch("https://hooks.slack.com/services/T000/B000/XXXX", { method: "post", body: JSON.stringify({ text }) });
}
