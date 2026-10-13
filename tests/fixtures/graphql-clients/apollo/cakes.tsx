import { gql, useApolloClient, useMutation, useQuery, useSubscription } from "@apollo/client";
import { client } from "./client";
import { LIST_CAKES, ORDER_CAKE, OVEN_STATUS } from "./documents";

export function useCakes() {
  return useQuery(LIST_CAKES, { variables: { first: 12 } });
}

export function useOrderCake() {
  return useMutation(ORDER_CAKE);
}

export function useOven() {
  return useSubscription(OVEN_STATUS);
}

export async function refreshCake(id: string) {
  const apollo = useApolloClient();
  return apollo.query({ query: gql`query CakeById($id: ID!) { cake(id: $id) { id name } }`, variables: { id } });
}

export async function orderNow(cakeId: string) {
  return client.mutate({ mutation: ORDER_CAKE, variables: { cakeId } });
}
