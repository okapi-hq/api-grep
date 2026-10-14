import "@shopify/shopify-api/adapters/node";
import { LATEST_API_VERSION, shopifyApi } from "@shopify/shopify-api";

const shopify = shopifyApi({
  apiKey: process.env.KITE_API_KEY,
  apiSecretKey: process.env.KITE_API_SECRET,
  scopes: ["read_products"],
  hostName: "kites.example.dev",
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

export default shopify;
