const SERVICE = "https://ws.example-carrier.com/track/v2";

export async function track(id: string) {
  const envelope = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TrackRequest><Id>${id}</Id></TrackRequest></soap:Body></soap:Envelope>`;
  return fetch(SERVICE, {
    method: "POST",
    headers: { "content-type": "text/xml", SOAPAction: "http://example-carrier.com/Track" },
    body: envelope,
  });
}

// no SOAPAction: the first element of the body names the operation
export async function cancel(shipmentId: string) {
  return fetch(SERVICE, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8" },
    body: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
    <CancelShipment><ShipmentId>${shipmentId}</ShipmentId><Reason>customer</Reason></CancelShipment>
  </soapenv:Body>
</soapenv:Envelope>`,
  });
}

// SOAP 1.2: the action travels in the content type
export async function rates(zip: string) {
  return fetch(SERVICE, {
    method: "POST",
    headers: { "Content-Type": 'application/soap+xml; charset=utf-8; action="urn:example-carrier:GetRates"' },
    body: `<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body><GetRates><Zip>${zip}</Zip></GetRates></env:Body></env:Envelope>`,
  });
}

// a plain XML document, no SOAP
export async function createOrder(sku: string) {
  return fetch("https://orders.example-shop.com/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: `<Order><Line><Sku>${sku}</Sku><Qty>1</Qty></Line><Line><Sku>gift-wrap</Sku></Line></Order>`,
  });
}

// built with the DOM: XML, its structure unread
export async function sendFeed(doc: Document) {
  return fetch("https://feeds.example-shop.com/import", { method: "POST", body: new XMLSerializer().serializeToString(doc) });
}

// an XML content type on a value the scan cannot read
export async function forward(payload: string) {
  return fetch("https://feeds.example-shop.com/import", { method: "POST", headers: { "content-type": "text/xml" }, body: payload });
}

// a helper: each caller's action is an operation
async function soapCall(action: string, body: string) {
  return fetch(SERVICE, { method: "POST", headers: { "content-type": "text/xml", SOAPAction: action }, body });
}

export const pickup = () => soapCall("http://example-carrier.com/SchedulePickup", "<Envelope><Body><SchedulePickup/></Body></Envelope>");
export const status = () => soapCall("http://example-carrier.com/PickupStatus", "<Envelope><Body><PickupStatus/></Body></Envelope>");
