const Shopify = require("shopify-api-node");

const shop = new Shopify({ shopName: "example-lamps", accessToken: process.env.LAMP_TOKEN, apiVersion: "2024-07" });

async function syncLamps(since) {
  const lamps = await shop.product.list({ limit: 50, since_id: since });
  const count = await shop.product.count();
  return { lamps, count };
}

async function renameLamp(id, title) {
  return shop.product.update(id, { title });
}

async function lampImages(productId) {
  return shop.productImage.list(productId);
}

async function closeOrder(id) {
  return shop.order.close(id);
}

/** An untyped parameter holding a client the callers pass. */
async function newCustomer(store, email) {
  return store.customer.create({ email, verified_email: true });
}

/** Prisma's client, given as an untyped parameter: `product.create` is not a Shopify call. */
async function saveLocal(db, title) {
  return db.product.create({ data: { title } });
}

module.exports = { syncLamps, renameLamp, lampImages, closeOrder, onboard: (email) => newCustomer(shop, email), saveLocal };
