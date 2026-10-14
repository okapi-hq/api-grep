const Shopify = require("shopify-api-node");

const shop = new Shopify({ shopName: "example-kites", accessToken: process.env.KITE_TOKEN, apiVersion: "2024-07" });

async function addAddress(customerId, city) {
  return shop.customerAddress.create(customerId, { city, country: "FR" });
}

async function holdOrder(fulfillmentOrderId) {
  return shop.fulfillmentOrder.hold(fulfillmentOrderId, { reason: "awaiting_payment", notify_merchant: true });
}

async function closeOrder(fulfillmentOrderId) {
  return shop.fulfillmentOrder.close(fulfillmentOrderId, "Closed by the warehouse");
}

async function askToCancel(fulfillmentOrderId) {
  return shop.cancellationRequest.create(fulfillmentOrderId, "Customer changed their mind");
}

async function disableCard(id) {
  return shop.giftCard.disable(id);
}

module.exports = { addAddress, holdOrder, closeOrder, askToCancel, disableCard };
