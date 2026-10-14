import type { Storefront } from "@shopify/hydrogen";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@shopify/remix-oxygen";

const TEA_QUERY = `#graphql
  query TeaDetails($handle: String!) { product(handle: $handle) { id title } }
`;

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { product } = await context.storefront.query(TEA_QUERY, { variables: { handle: params.handle } });
  return { product, related: await relatedTeas(context.storefront, product.id) };
}

export async function collections({ context: { storefront } }: LoaderFunctionArgs) {
  return storefront.query(`query TeaCollections { collections(first: 10) { nodes { handle } } }`);
}

export async function shopInfo({ context }: LoaderFunctionArgs) {
  const { storefront, env } = context;
  return storefront.query(`query ShopInfo { shop { name } }`, { cache: env.cache });
}

async function relatedTeas(storefront: Storefront, productId: string) {
  return storefront.query(`query RelatedTeas($productId: ID!) { productRecommendations(productId: $productId) { id } }`, { variables: { productId } });
}

export async function action({ context }: ActionFunctionArgs) {
  await context.customerAccount.mutate(`mutation SaveTeaPreference($tea: String!) { customerUpdate(customer: { firstName: $tea }) { userErrors { message } } }`, { variables: { tea: "oolong" } });
  return context.customerAccount.query(`query CustomerName { customer { firstName } }`);
}
