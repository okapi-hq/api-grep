const SHOP_URL = "https://example-shop.myshopify.com/admin/api/2024-01/graphql.json";

const GET_ORDER = `query GetOrder($id: ID!) { order(id: $id) { id totalPriceSet { shopMoney { amount } } customer { email } } }`;

export function getOrder(id: string, token: string) {
  return fetch(SHOP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: GET_ORDER, variables: { id } }),
  });
}

export function currentShop(token: string) {
  return fetch(SHOP_URL, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: "{ shop { name currencyCode } locations(first: 5) { nodes { name } } }" }),
  });
}

export function cancelOrder(id: string, token: string) {
  return fetch(SHOP_URL, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation CancelOrder($id: ID!) {
        orderCancel(orderId: $id, refund: true) { job { id } userErrors { field message } }
      }`,
      variables: { id },
    }),
  });
}

export function orderTotals(id: string, token: string) {
  return fetch(SHOP_URL, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `query OrderTotals($id: ID!) { order(id: $id) { total: totalPriceSet { shopMoney { amount } } buyer: customer { mail: email } } }`,
      variables: { id },
    }),
  });
}

async function shopify(query: string, variables: Record<string, unknown>, token: string) {
  const res = await fetch(SHOP_URL, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export const product = (id: string, token: string) => shopify(`query GetProduct($id: ID!) { product(id: $id) { title } }`, { id }, token);
