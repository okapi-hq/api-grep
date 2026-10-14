import { ApiVersion, shopifyApp } from "@shopify/shopify-app-remix/server";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-07";

const shopify = shopifyApp({
  apiKey: process.env.KITE_APP_KEY,
  apiSecretKey: process.env.KITE_APP_SECRET || "",
  apiVersion: ApiVersion.July24,
  appUrl: process.env.KITE_APP_URL || "",
  restResources,
});

export default shopify;
export const authenticate = shopify.authenticate;
