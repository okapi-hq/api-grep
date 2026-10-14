const Shopify = require("shopify-api-node");

/** Wraps a client it is given, as a field. */
class StoreClient {
  constructor(client, debug = false) {
    if (!client) throw new Error("client required");
    this.client = client;
    this.debug = debug;
  }

  async graphql(query, variables) {
    const result = await this.client.graphql(query, variables);
    if (this.debug) console.log(result);
    return result;
  }

  /** `this.debug` is not a client: nothing is reported. */
  describe() {
    return this.debug.toString();
  }
}

const source = new Shopify({ shopName: "example-kites", accessToken: process.env.SOURCE_TOKEN, apiVersion: "2024-10" });
const store = new StoreClient(source, true);

async function syncThemes() {
  return store.graphql(`query ThemeList { themes(first: 5) { nodes { id name } } }`);
}

module.exports = { StoreClient, syncThemes };
