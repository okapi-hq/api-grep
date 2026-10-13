import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  hostName: "app.example-kites.dev",
  apiVersion: ApiVersion.October24,
  isEmbeddedApp: true,
});

export default shopify;
