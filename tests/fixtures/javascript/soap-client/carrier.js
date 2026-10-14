const soap = require("soap");

const WSDL = "https://ws.example-carrier.com/track.svc?singleWsdl";

function track(id, done) {
  soap.createClient(WSDL, function (err, client) {
    if (err) return done(err);
    client.Track({ Id: id }, done);
  });
}

async function cancel(id) {
  const client = await soap.createClientAsync(WSDL, {}, "https://ws-eu.example-carrier.com/track.svc");
  return client.CancelShipmentAsync({ Id: id });
}

module.exports = { track, cancel };
