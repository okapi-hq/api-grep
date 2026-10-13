import { ApolloClient, HttpLink, InMemoryCache, from } from "@apollo/client";
import { onError } from "@apollo/client/link/error";

const errorLink = onError(({ graphQLErrors }) => console.warn(graphQLErrors));

const httpLink = new HttpLink({
  uri: "https://api.example-bakery.com/graphql",
  headers: { "x-client-name": "storefront" },
});

export const client = new ApolloClient({ link: from([errorLink, httpLink]), cache: new InMemoryCache() });
