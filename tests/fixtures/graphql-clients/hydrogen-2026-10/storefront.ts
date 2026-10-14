import { createContext } from "react-router";
import { createCartServerHandlers, createShopifyRequestContext, createStorefrontClient, type CacheInstance } from "@shopify/hydrogen";

export const storefrontClientContext = createContext<ReturnType<typeof createStorefrontClient>>();

export const cartHandlers = createCartServerHandlers();

export function createRequestStorefrontClient(request: Request, env: { PUBLIC_STORE_DOMAIN: string; PRIVATE_STOREFRONT_API_TOKEN: string }, cache: CacheInstance) {
  return createStorefrontClient({
    type: "private",
    requestContext: createShopifyRequestContext({ request, i18n: { country: "US", language: "EN" } }),
    config: { storeDomain: env.PUBLIC_STORE_DOMAIN, privateStorefrontToken: env.PRIVATE_STOREFRONT_API_TOKEN, cache },
  });
}

export async function shopName(request: Request, env: { PUBLIC_STORE_DOMAIN: string; PRIVATE_STOREFRONT_API_TOKEN: string }, cache: CacheInstance) {
  const client = createRequestStorefrontClient(request, env, cache);
  const { data } = await client.graphql(`#graphql
    query TeaShop { shop { name } }
  `);
  return data?.shop.name;
}
