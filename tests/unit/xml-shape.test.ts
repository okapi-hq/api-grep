import { describe, expect, it } from "vitest";
import { toXml } from "../../src/examples/xml.js";
import { soapActionName } from "../../src/operation/soap.js";
import { isXmlContentType, looksLikeXml, xmlBody, xmlBodyShape } from "../../src/resolve/xml-shape.js";
import type { Part, Shape } from "../../src/types.js";

const text = (t: string): Part[] => [{ kind: "static", text: t }];
const str = (...values: string[]): Shape => ({ type: "string", ...(values.length ? { enum: values } : {}) });
const obj = (properties: Record<string, Shape>): Shape => ({ type: "object", properties, required: Object.keys(properties) });

describe("xmlBodyShape", () => {
  it("reads the root, then the child elements, down to the leaves' text", () => {
    expect(xmlBodyShape(text(`<?xml version="1.0"?><a:Root xmlns:a="urn:x"><Item id="1">x &amp; y</Item><Empty/></a:Root>`))).toEqual(
      obj({ "a:Root": obj({ Item: str("x & y"), Empty: str("") }) }),
    );
  });

  it("a computed part is a string named after it", () => {
    const parts: Part[] = [{ kind: "static", text: "<Req><Id>" }, { kind: "dynamic", name: "orderId", origin: "param" }, { kind: "static", text: "</Id></Req>" }];
    expect(xmlBodyShape(parts)).toEqual(obj({ Req: obj({ Id: { type: "string", hint: "orderId" } }) }));
    expect(xmlBody(parts)?.dynamic).toEqual([{ where: "body", name: "orderId", origin: "param" }]);
  });

  it("a computed element name is a dynamic key", () => {
    const parts: Part[] = [{ kind: "static", text: "<Req><" }, { kind: "dynamic", name: "tag", origin: "param" }, { kind: "static", text: "/><Known/></Req>" }];
    expect(xmlBodyShape(parts)).toEqual({ type: "object", properties: { Req: { ...obj({ Known: str("") }), dynamicKeys: true } }, required: ["Req"] });
  });

  it("repeated elements are an array; comments, CDATA and processing instructions are read", () => {
    expect(xmlBodyShape(text("<L><!-- c --><I>1</I><I>2</I><?pi x?><N><![CDATA[<b>]]></N></L>"))).toEqual(
      obj({ L: obj({ I: { type: "array", items: str("1") }, N: str("<b>") }) }),
    );
  });

  it("never expands a DTD's entities", () => {
    const doc = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd"><!ENTITY big "aaaa">]><r><v>&e;&big;</v></r>`;
    expect(xmlBodyShape(text(doc))).toEqual(obj({ r: obj({ v: str("&e;&big;") }) }));
  });

  it("malformed, oversized or too deep documents stay plain XML strings", () => {
    for (const doc of ["<a><b></a>", "<a></a><b></b>", "<a/>text<b/>", `<a>${"<b>".repeat(40)}${"</b>".repeat(40)}</a>`, `<a>${"<b/>".repeat(600)}</a>`, `<a>${"x".repeat(70000)}</a>`]) {
      expect(xmlBodyShape(text(doc)), doc.slice(0, 20)).toEqual({ type: "string" });
    }
  });

  it("keys a report cannot hold are left out", () => {
    expect(xmlBodyShape(text("<r><constructor/><ok/></r>"))).toEqual({ type: "object", properties: { r: { ...obj({ ok: str("") }), dynamicKeys: true } }, required: ["r"] });
    expect(xmlBodyShape(text("<__proto__/>"))).toEqual({ type: "string" });
  });

  it("text that is not XML is not read", () => {
    for (const t of ["hello", "a=1&b=2", "<3 you", "<not closed"]) expect(looksLikeXml(t), t).toBe(false);
    expect(xmlBodyShape(text("{\"a\":1}"))).toBeUndefined();
  });
});

describe("isXmlContentType", () => {
  it("matches XML media types only", () => {
    for (const v of ["text/xml", "application/xml; charset=utf-8", "application/soap+xml;action=x", "application/atom+xml"]) expect(isXmlContentType(v), v).toBe(true);
    for (const v of ["application/json", "text/xml-ish", "application/xhtml", null, undefined]) expect(isXmlContentType(v), String(v)).toBe(false);
  });
});

describe("soapActionName", () => {
  it("is the action's last segment", () => {
    expect(soapActionName("http://example.com/Svc/Track")).toBe("Track");
    expect(soapActionName('"urn:example:Track"')).toBe("Track");
    expect(soapActionName("Svc#Track")).toBe("Track");
    expect(soapActionName('""')).toBeUndefined();
    expect(soapActionName("")).toBeUndefined();
  });
});

describe("toXml", () => {
  it("writes elements from an example value, escaping text", () => {
    expect(toXml({ Req: { Id: "a<b", Line: [{ Sku: "x" }, { Sku: "y" }], Empty: "" } })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><Req><Id>a&lt;b</Id><Line><Sku>x</Sku></Line><Line><Sku>y</Sku></Line><Empty></Empty></Req>`,
    );
    expect(toXml("<as-is/>")).toBe("<as-is/>");
  });
});
