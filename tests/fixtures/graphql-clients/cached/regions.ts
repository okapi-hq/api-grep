import { GraphQLClient, gql } from "graphql-request";

const ENDPOINTS: Record<string, string> = {
  eu: "https://eu.example-catalog.net/graphql",
  us: "https://us.example-catalog.net/graphql",
};

const clients = new Map<string, GraphQLClient>();

// one client per region, built on first use: which endpoint a call uses depends on the region
function catalogFor(region: string): GraphQLClient {
  let client = clients.get(region);
  if (!client) {
    client = new GraphQLClient(ENDPOINTS[region]);
    clients.set(region, client);
  }
  return client;
}

const PRODUCTS = gql`
  query Products { products { id name } }
`;

export async function products(region: string) {
  return catalogFor(region).request(PRODUCTS);
}
