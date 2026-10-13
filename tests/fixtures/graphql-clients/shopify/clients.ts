import { createAdminApiClient, createAdminRestApiClient } from "@shopify/admin-api-client";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
import Shopify from "shopify-api-node";

const admin = createAdminApiClient({ storeDomain: "example-tea.myshopify.com", apiVersion: "2025-01", accessToken: process.env.SHOPIFY_TOKEN ?? "" });
const storefront = createStorefrontApiClient({ storeDomain: "example-tea.myshopify.com", apiVersion: "2025-01", publicAccessToken: "public" });
const rest = createAdminRestApiClient({ storeDomain: "example-tea.myshopify.com", apiVersion: "2025-01", accessToken: "token" });
const legacy = new Shopify({ shopName: "example-tea", accessToken: "token", apiVersion: "2024-10" });

export const inventory = (id: string) => admin.request(`query InventoryLevel($id: ID!) { inventoryItem(id: $id) { tracked } }`, { variables: { id } });

export const cart = () => storefront.request(`mutation CreateCart { cartCreate { cart { id checkoutUrl } } }`);

// the REST client of the same package is not a GraphQL call
export const products = () => rest.request("products");

export const shopName = () => legacy.graphql(`query ShopName { shop { name } }`);
