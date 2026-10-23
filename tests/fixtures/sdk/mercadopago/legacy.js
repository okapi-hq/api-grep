const mercadopago = require("mercadopago");

mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });

async function legacyCheckout(title) {
  const res = await mercadopago.preferences.create({ items: [{ title, quantity: 1, unit_price: 10 }] });
  return res.body.init_point;
}

const legacyStatus = (id) => mercadopago.payment.findById(id);

const legacySearch = () => mercadopago.payment.search({ qs: { status: "approved" } });

const legacyUpdate = (id) => mercadopago.preferences.update({ id, expires: true });

module.exports = { legacyCheckout, legacyStatus, legacySearch, legacyUpdate };
