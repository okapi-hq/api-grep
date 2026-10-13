import { ApolloClient, InMemoryCache } from "@apollo/client";

export const storeClient = new ApolloClient({
  uri: "https://store.example-garden.com/graphql",
  headers: { authorization: `Bearer ${process.env.GARDEN_TOKEN}` },
  cache: new InMemoryCache(),
});

export const adminClient = new ApolloClient({ uri: `${process.env.ADMIN_API_URL}/graphql`, cache: new InMemoryCache() });
