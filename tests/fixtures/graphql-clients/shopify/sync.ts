import { ApiVersion, shopifyApi, type Session } from "@shopify/shopify-api";

const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-tea.com", apiVersion: ApiVersion.July24, isEmbeddedApp: false });

export async function recentOrders(session: Session) {
  const client = new shopify.clients.Graphql({ session, apiVersion: "2024-07" });
  return client.request(`query RecentOrders { orders(first: 5) { nodes { id name } } }`);
}

export async function tagOrder(session: Session, id: string) {
  const client = new shopify.clients.Graphql({ session });
  return client.query({ data: { query: `mutation TagOrder($id: ID!) { tagsAdd(id: $id, tags: ["vip"]) { userErrors { message } } }`, variables: { id } } });
}

export async function storefrontMenu(session: Session) {
  const client = new shopify.clients.Storefront({ session, apiVersion: "2024-07" });
  return client.request(`query Menu { menu(handle: "main") { items { title } } }`);
}
