import { describe, expect, it } from "vitest";
import type { Shape } from "../src/types.js";
import { at, scanFixture } from "./fixture-helpers.js";

describe("SOAP: the action is the call's operation, the envelope an XML body (#36)", () => {
  it("typescript: the envelope is an XML body: its elements, an XML example", async () => {
    const track = at(await scanFixture("soap"), "carrier.ts", 5);
    expect(track).toMatchObject({ method: "POST", pathTemplate: "/track/v2", bodyEncoding: "xml" });
    const leaf: Shape = { type: "object", properties: { Id: { type: "string", hint: "id" } }, required: ["Id"] };
    const body: Shape = { type: "object", properties: { TrackRequest: leaf }, required: ["TrackRequest"] };
    const envelope: Shape = { type: "object", properties: { "soap:Body": body }, required: ["soap:Body"] };
    expect(track.body).toEqual({ type: "object", properties: { "soap:Envelope": envelope }, required: ["soap:Envelope"] });
    expect(track.examples[0]?.bodyEncoding).toBe("xml");
    expect(String(track.examples[0]?.body)).toMatch(/^<\?xml [^>]*\?><soap:Envelope><soap:Body><TrackRequest><Id>[^<]+<\/Id>/);
  });

  it("typescript: SOAPAction, the body's first element, SOAP 1.2 action, helpers", async () => {
    const r = await scanFixture("soap");
    expect(at(r, "carrier.ts", 5).operation).toEqual({ protocol: "soap", name: "Track", dynamic: false, from: "header" });
    expect(at(r, "carrier.ts", 14).operation).toEqual({ protocol: "soap", name: "CancelShipment", dynamic: false, from: "body" });
    expect(at(r, "carrier.ts", 28).operation).toEqual({ protocol: "soap", name: "GetRates", dynamic: false, from: "header" });
    // inside the helper, every action its callers pass; at each caller, its own
    expect(at(r, "carrier.ts", 56).operation).toMatchObject({ name: "SchedulePickup", alternatives: ["SchedulePickup", "PickupStatus"] });
    expect([59, 60].map((line) => at(r, "carrier.ts", line).operation?.name)).toEqual(["SchedulePickup", "PickupStatus"]);
  });

  it("typescript: XML that is not SOAP is XML with no operation", async () => {
    const r = await scanFixture("soap");
    const order = at(r, "carrier.ts", 37);
    expect(order.bodyEncoding).toBe("xml");
    expect(order.operation).toBeUndefined();
    // a repeated element is an array
    expect(order.body).toMatchObject({ properties: { Order: { properties: { Line: { type: "array" } } } } });
    // the DOM serializer and an XML content type on an unread value
    expect([46, 51].map((line) => at(r, "carrier.ts", line).bodyEncoding)).toEqual(["xml", "xml"]);
  });

  it("python: format() and f-string envelopes, ElementTree", async () => {
    const r = await scanFixture("python/soap");
    expect(at(r, "carrier.py", 18)).toMatchObject({ bodyEncoding: "xml", operation: { protocol: "soap", name: "CancelShipment", from: "body" } });
    expect(at(r, "carrier.py", 23)).toMatchObject({ bodyEncoding: "xml", operation: { protocol: "soap", name: "Track", from: "header" } });
    expect(at(r, "carrier.py", 29).bodyEncoding).toBe("xml");
    expect(at(r, "carrier.py", 29).operation).toBeUndefined();
  });

  it("php: heredoc with Guzzle, concatenated envelope with curl, SimpleXML", async () => {
    const r = await scanFixture("php/soap");
    expect(at(r, "Carrier.php", 22)).toMatchObject({ client: "guzzle", bodyEncoding: "xml", operation: { protocol: "soap", name: "Rates", from: "header" } });
    expect(at(r, "Carrier.php", 35)).toMatchObject({ client: "curl", bodyEncoding: "xml", operation: { protocol: "soap", name: "PrintLabel", from: "body" } });
    expect(at(r, "Carrier.php", 42).bodyEncoding).toBe("xml");
    expect(at(r, "Carrier.php", 42).operation).toBeUndefined();
  });
});

describe("action-style APIs: the provider's operation parameter (#36)", () => {
  it("typescript: query string, form body, params with a branch, a provider with no declaration", async () => {
    const r = await scanFixture("action-api");
    expect(at(r, "cloud.ts", 5).operation).toEqual({ protocol: "action", name: "DescribeInstances", dynamic: false, from: "query" });
    expect(at(r, "cloud.ts", 10).operation).toEqual({ protocol: "action", name: "SendMessage", dynamic: false, from: "body" });
    expect(at(r, "cloud.ts", 19).operation).toEqual({ protocol: "action", name: "Subscribe", alternatives: ["Subscribe", "Unsubscribe"], dynamic: false, from: "query" });
    expect(at(r, "cloud.ts", 24).operation).toMatchObject({ name: "flickr.photos.search", from: "query" });
    expect(at(r, "cloud.ts", 29).operation).toBeUndefined();
    expect(at(r, "cloud.ts", 34).operation).toBeUndefined();
  });

  it("python and php", async () => {
    const py = await scanFixture("python/soap");
    expect(at(py, "carrier.py", 33).operation).toMatchObject({ protocol: "action", name: "SendMessage", from: "body" });
    expect(at(py, "carrier.py", 37).operation).toMatchObject({ protocol: "action", name: "flickr.photos.search", from: "query" });
    const php = await scanFixture("php/soap");
    expect(at(php, "Carrier.php", 47).operation).toMatchObject({ protocol: "action", name: "ListTopics", from: "query" });
  });
});
