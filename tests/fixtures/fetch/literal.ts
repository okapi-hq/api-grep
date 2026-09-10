const key = process.env.STRIPE_KEY;

export async function createCustomer(email: string) {
  const res = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, name: "Ada Lovelace", "metadata[plan]": "pro" }),
  });
  return res.json();
}
