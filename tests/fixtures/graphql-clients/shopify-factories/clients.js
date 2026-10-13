import shopify from "./shopify.js";
import { loadSession } from "./sessions.js";

const offline = {
  graphqlClient: async ({ shop }) => {
    const session = await loadSession(shop);
    const client = new shopify.clients.Graphql({ session });
    return { client, shop, session };
  },
  async storefrontClient({ shop }) {
    const session = await loadSession(shop);
    return { client: new shopify.clients.Storefront({ session }), shop };
  },
};

const online = {
  graphqlClient: async ({ req }) => {
    const session = await loadSession(req.query.shop);
    const client = new shopify.clients.Graphql({ session });
    return { client, session };
  },
};

const clientProvider = { offline, online };

export default clientProvider;
