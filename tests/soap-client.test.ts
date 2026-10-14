import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

const op = (name: string | null, extra: object = {}): object => ({ protocol: "soap", name, dynamic: false, from: "body", ...extra });

describe("SOAP client libraries in PHP: the WSDL's service and the operation called (#58)", () => {
  it("php: SoapClient magic methods and __soapCall, the WSDL URL without its query, the message as an XML body", async () => {
    const r = await scanFixture("php/soap-client");
    const track = at(r, "Tracker.php", 21);
    expect(track).toMatchObject({ client: "php-soap", method: "POST", host: "ws.example-carrier.com", pathTemplate: "/track", bodyEncoding: "xml", operation: op("Track") });
    expect(track.body).toEqual({ type: "object", properties: { Id: { type: "string", hint: "id" } }, required: ["Id"] });
    expect(track.examples[0]?.body).toMatch(/^<\?xml [^>]*\?><Id>[^<]*<\/Id>$/);
    // `__soapCall('CancelShipment', [$args])`: the name argument, the first of the arguments
    expect(at(r, "Tracker.php", 27)).toMatchObject({ operation: op("CancelShipment"), body: { properties: { Reason: { enum: ["customer"] } } } });
    // `__soapCall($operation, ...)` with no caller: the name is not known
    expect(at(r, "Tracker.php", 59).operation).toEqual({ protocol: "soap", name: null, dynamic: true, from: "body" });
  });

  it("php: the location option wins, non-WSDL mode, a WSDL file of the repository, subclasses", async () => {
    const r = await scanFixture("php/soap-client");
    expect(at(r, "Tracker.php", 32)).toMatchObject({ host: "rates.example-carrier.com", pathTemplate: "/soap", operation: op("GetRates") });
    expect(at(r, "Tracker.php", 38)).toMatchObject({ host: "ws.example-weather.com", pathTemplate: "/soap", operation: op("Forecast") });
    // `__DIR__ . '/wsdl/labels.wsdl'`: its `soap:address`; a method it does not declare is not an operation; PHP
    // finds `voidLabel` as the WSDL's `VoidLabel`; `login` is basic authentication
    expect(at(r, "Tracker.php", 46)).toMatchObject({ host: "labels.example-carrier.com", pathTemplate: "/soap/v1", operation: op("PrintLabel") });
    expect(at(r, "Tracker.php", 53)).toMatchObject({ operation: op("VoidLabel"), authScheme: "basic" });
    expect(r.calls.filter((c) => c.location.file === "Tracker.php" && c.location.line > 42 && c.location.line < 53)).toHaveLength(1);
    // `$this->TrackStatus()` in a subclass: its `parent::__construct($wsdl)`
    expect(at(r, "CarrierClient.php", 14)).toMatchObject({ host: "ws.example-carrier.com", pathTemplate: "/status", operation: op("TrackStatus") });
    // a typed parameter, a subclass built elsewhere: the operation, on a host the scan does not know
    for (const line of [20, 25]) expect(at(r, "CarrierClient.php", line)).toMatchObject({ client: "php-soap", hostKind: "unknown", provider: "unknown" });
  });
});

describe("SOAP client libraries in Python, TypeScript and JavaScript (#58)", () => {
  it("python: zeep's service, bound services, create_service's address, a WSDL file, a client on self", async () => {
    const r = await scanFixture("python/soap-client");
    expect(at(r, "carrier.py", 12)).toMatchObject({ client: "zeep", method: "POST", host: "ws.example-carrier.com", pathTemplate: "/track", bodyEncoding: "xml", operation: op("Track") });
    expect(at(r, "carrier.py", 12).body).toMatchObject({ type: "object", properties: { Id: { hint: "tracking_id" } } });
    // positional parts of an RPC message: their names are the WSDL's
    expect(at(r, "carrier.py", 17)).toMatchObject({ operation: op("CancelShipment"), bodyEncoding: "xml", body: { type: "dynamic", origin: "unknown" } });
    expect(at(r, "carrier.py", 22)).toMatchObject({ pathTemplate: "/rates.asmx", operation: op("GetRates") });
    expect(at(r, "carrier.py", 27)).toMatchObject({ host: "ws.example-carrier.com", operation: op("Track") });
    expect(at(r, "carrier.py", 32)).toMatchObject({ host: "eu.example-carrier.com", pathTemplate: "/soap/track" });
    expect(at(r, "carrier.py", 37)).toMatchObject({ host: "labels.example-carrier.com", pathTemplate: "/soap/v1", operation: op("PrintLabel") });
    expect(at(r, "carrier.py", 42)).toMatchObject({ hostKind: "env", envName: "CARRIER_WSDL" });
    expect(at(r, "carrier.py", 50)).toMatchObject({ host: "ws.example-archive.com", operation: op("Store") });
  });

  it("typescript and javascript: node-soap clients, callbacks, endpoints, Service.Port, WSDL files", async () => {
    const r = await scanFixture("soap-client");
    expect(at(r, "carrier.ts", 9)).toMatchObject({ client: "node-soap", method: "POST", host: "ws.example-carrier.com", pathTemplate: "/track", bodyEncoding: "xml", operation: op("Track") });
    expect(at(r, "carrier.ts", 16)).toMatchObject({ operation: op("CancelShipment"), body: { properties: { Reason: { enum: ["customer"] } } } });
    expect(at(r, "carrier.ts", 24)).toMatchObject({ host: "rates.example-carrier.com", pathTemplate: "/soap", operation: op("GetRates") });
    expect(at(r, "carrier.ts", 29)).toMatchObject({ host: "labels.example-carrier.com", operation: op("PrintLabel") });
    // `UnknownOperationAsync` is not in the WSDL; `addSoapHeader` and `describe` are the client's own
    expect(r.calls.filter((c) => [22, 23, 34].includes(c.location.line))).toEqual([]);
    expect(at(r, "carrier.ts", 43)).toMatchObject({ hostKind: "unknown", operation: op("Store") });
    expect(at(r, "carrier.ts", 53)).toMatchObject({ host: "ws.example-carrier.com", pathTemplate: "/pickup", operation: op("SchedulePickup") });
    const js = await scanFixture("javascript/soap-client");
    expect(at(js, "carrier.js", 8)).toMatchObject({ client: "node-soap", host: "ws.example-carrier.com", pathTemplate: "/track.svc", operation: op("Track") });
    expect(at(js, "carrier.js", 14)).toMatchObject({ host: "ws-eu.example-carrier.com", operation: op("CancelShipment") });
  });

  it("classes named like a SOAP client that are not one give no call", async () => {
    for (const name of ["php/soap-client-negative", "python/soap-client-negative", "soap-client-negative"]) {
      expect((await scanFixture(name)).calls, name).toEqual([]);
    }
  });
});
