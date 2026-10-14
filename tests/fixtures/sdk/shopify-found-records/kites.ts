import { ApiVersion, shopifyApi, type Session } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-07";

const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-kites.dev", apiVersion: ApiVersion.July24, isEmbeddedApp: false, restResources });

export async function retitleKite(session: Session, id: number, title: string) {
  const kite = await shopify.rest.Product.find({ session, id });
  if (!kite) return null;
  kite.title = title;
  kite.tags = "kites, summer";
  await kite.save({ update: true });
  return kite;
}

export async function retireKite(session: Session, kiteId: number) {
  const kite = await shopify.rest.Product.find({ session, id: kiteId });
  await kite?.delete();
}

export async function recolourKite(session: Session, productId: number, variantId: number, colour: string) {
  const variant = await shopify.rest.Variant.find({ session, product_id: productId, id: variantId });
  variant.option1 = colour;
  await variant.save();
}

export async function closeKiteOrder(session: Session, orderId: number) {
  const order = await shopify.rest.Order.find({ session, id: orderId });
  await order!.close({});
}

export async function listedKites(session: Session) {
  // a page of records is not a record: `all` returns `{ data, pageInfo }`
  const page = await shopify.rest.Product.all({ session, limit: 10 });
  return page.data;
}
