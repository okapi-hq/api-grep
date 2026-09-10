type Card = { kind: "card"; number: string; expMonth: number };
type Bank = { kind: "bank"; iban: string };

export function pay(method: Card | Bank, idempotencyKey: string) {
  return fetch("https://api.payments.example.com/v1/charges", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, "X-Api-Version": "2024-06-01" },
    body: JSON.stringify({ currency: "eur", amount: 1200, source: method, capture: true }),
  });
}

export function login(email: string, password: string) {
  return fetch("https://auth.example.com/oauth/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", username: email, password }),
  });
}

interface Invite {
  email: string;
  role: "admin" | "member";
  message?: string;
  sendNotification?: boolean;
}

export function invite(input: Invite) {
  return fetch("https://api.example.com/v1/invites", { method: "POST", body: JSON.stringify(input) });
}
