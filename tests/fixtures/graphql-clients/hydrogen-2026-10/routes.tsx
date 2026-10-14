import { getCart, getCartId } from "@shopify/hydrogen";
import type { LoaderFunctionArgs } from "react-router";
import { cartHandlers, storefrontClientContext } from "./storefront";

const TEA_QUERY = `#graphql
  query TeaProduct($handle: String!) {
    product(handle: $handle) { title description }
  }
`;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const storefrontClient = context.get(storefrontClientContext);
  const { data } = await storefrontClient.graphql(TEA_QUERY, { variables: { handle: params.handle } });
  const cart = await cartHandlers.get({ storefrontClient, request });
  return { tea: data?.product, cart: cart.data };
}

export async function miniCart({ context, request }: LoaderFunctionArgs) {
  const storefrontClient = context.get(storefrontClientContext);
  return getCart(getCartId(request), storefrontClient);
}

/** Not Hydrogen's client: a value the code builds itself under the same name. */
export function localClient() {
  const storefrontClient = { graphql: (query: string) => query.length };
  return storefrontClient.graphql("query Local { shop { name } }");
}
