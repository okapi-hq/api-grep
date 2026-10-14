import { createAdminRestApiClient } from "@shopify/admin-api-client";
import { ApiVersion, shopifyApi, type Session } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-07";

const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-lamps.dev", apiVersion: ApiVersion.July24, isEmbeddedApp: false, restResources });

export async function recentOrders(session: Session) {
  const client = new shopify.clients.Rest({ session, apiVersion: "2024-07" });
  return client.get({ path: "orders", query: { status: "any" } });
}

export async function tagLamp(session: Session, id: string) {
  const client = new shopify.clients.Rest({ session });
  return client.put({ path: `products/${id}.json`, data: { product: { id, tags: "lamp" } } });
}

export async function lampCount(session: Session) {
  return shopify.rest.Product.count({ session });
}

export async function oneVariant(session: Session, id: number) {
  return shopify.rest.Variant.find({ session, id });
}

const rest = createAdminRestApiClient({ storeDomain: "example-lamps.myshopify.com", apiVersion: "2024-10", accessToken: "token" });

export const locations = () => rest.get("/locations");

export const newRedirect = (path: string) => rest.post("redirects", { data: { redirect: { path, target: "/" } } });
