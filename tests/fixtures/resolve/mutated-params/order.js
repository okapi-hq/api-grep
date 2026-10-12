export function order(item, rush) {
  const body = { item };
  body.quantity = 1;
  if (rush) body["priority"] = "high";
  return fetch("https://api.example-shop.com/v1/orders", { method: "POST", body: JSON.stringify(body) });
}
