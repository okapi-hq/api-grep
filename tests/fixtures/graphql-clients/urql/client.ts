import { cacheExchange, createClient, fetchExchange } from "urql";

export const client = createClient({
  url: "https://api.example-library.org/graphql",
  exchanges: [cacheExchange, fetchExchange],
  fetchOptions: { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } },
});
