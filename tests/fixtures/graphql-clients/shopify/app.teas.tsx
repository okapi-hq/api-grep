import { authenticate, unauthenticated } from "./shopify.server";

export async function loader({ request }: { request: Request }) {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
    query ListTeas($first: Int!) { products(first: $first) { nodes { id title } } }`,
    { variables: { first: 10 } },
  );
  return response.json();
}

export async function restock(shop: string, id: string) {
  const { admin } = await unauthenticated.admin(shop);
  return admin.graphql(`mutation Restock($id: ID!) { inventoryActivate(inventoryItemId: $id, locationId: "1") { userErrors { message } } }`, { variables: { id } });
}
