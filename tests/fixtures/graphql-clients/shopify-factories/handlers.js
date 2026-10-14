import clientProvider from "./clients.js";
import { makeLogger } from "./sessions.js";

export async function shopName(req, res) {
  const { client } = await clientProvider.online.graphqlClient({ req, res });
  const shop = await client.request(`query ShopName { shop { name } }`);
  res.send(shop.data.shop.name);
}

export async function kites(shop) {
  const { client } = await clientProvider.offline.graphqlClient({ shop });
  return client.request(`query KiteList($first: Int!) { products(first: $first) { nodes { id title } } }`, { variables: { first: 20 } });
}

export async function cart(shop) {
  const offline = await clientProvider.offline.storefrontClient({ shop });
  return offline.client.request(`mutation NewCart { cartCreate { cart { id } } }`);
}

export function log() {
  const { logger } = makeLogger();
  logger.request("not an API call");
}
