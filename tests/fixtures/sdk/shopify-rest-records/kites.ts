import { ApiVersion, shopifyApi, type Session } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-07";

const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-kites.dev", apiVersion: ApiVersion.July24, isEmbeddedApp: false, restResources });

export async function newKite(session: Session, title: string) {
  const kite = new shopify.rest.Product({ session });
  kite.title = title;
  kite.vendor = "Example Kites";
  await kite.save({ update: true });
  return kite;
}

export async function renameKite(session: Session, id: number, title: string) {
  const kite = new shopify.rest.Product({ session });
  kite.id = id;
  kite.title = title;
  await kite.save();
}

export async function addColour(session: Session, productId: number, colour: string) {
  const variant = new shopify.rest.Variant({ session });
  variant.product_id = productId;
  variant.option1 = colour;
  await variant.save();
}

export async function closeKiteOrder(session: Session, id: number) {
  const order = new shopify.rest.Order({ session });
  order.id = id;
  await order.close({});
}

export async function dropKite(session: Session, id: number) {
  const kite = new shopify.rest.Product({ session });
  kite.id = id;
  await kite.delete();
}

export async function kiteNotes(session: Session, productId: number) {
  return shopify.rest.Metafield.all({ session, product_id: productId });
}

export async function shopNotes(session: Session) {
  return shopify.rest.Metafield.all({ session });
}
