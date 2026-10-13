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

});

describe("xmlBodyShape: hostile, malformed and non-XML text", () => {
  it("oversized or too deep documents, and malformed ones that declare XML, stay plain XML strings", () => {
    const decl = '<?xml version="1.0"?>';
    for (const doc of [`${decl}<r><v></r>`, `${decl}<r/><v/>`, `<r>${"<v>".repeat(40)}${"</v>".repeat(40)}</r>`, `<r>${"<v/>".repeat(600)}</r>`, `<r>${"x".repeat(70000)}</r>`]) {
      expect(xmlBodyShape(text(doc)), doc.slice(0, 30)).toEqual({ type: "string" });
    }
  });

  it("malformed text with no XML declaration is not XML", () => {
    for (const doc of ["<r><v></r>", "<r></r><v></v>", "<r/>text<v/>", "<Unclosed>", "<r><!-- never closed ><v/></r>", "<r><![CDATA[never closed]><v/></r>"]) {
      expect(xmlBodyShape(text(doc)), doc).toBeUndefined();
    }
  });

  it("an unterminated comment or CDATA ends the reading at once (no rescan at every `<!--`)", () => {
    for (const unit of ["<!-- >", "<![CDATA[x]>"]) {
      const started = performance.now();
      expect(xmlBodyShape(text(`<r>${unit.repeat(60000 / unit.length)}</r>`))).toBeUndefined();
      expect(performance.now() - started).toBeLessThan(50);
    }
  });

  it("HTML and SVG markup is not an XML document, also too large to read; an API's PascalCase element is", () => {
    for (const doc of ["<p>Hello</p>", "<html><body><h1>Hi</h1></body></html>", "<!DOCTYPE html><html><body/></html>", "<DIV><P>x</P></DIV>", '<svg width="1"><rect/></svg>', "<b>", `<html>${"<p/>".repeat(600)}</html>`]) {
      expect(xmlBodyShape(text(doc)), doc.slice(0, 30)).toBeUndefined();
    }
    expect(xmlBodyShape(text("<Table><Row>1</Row></Table>"))).toEqual(obj({ Table: obj({ Row: str("1") }) }));
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
    // xmltodict's attribute and text keys are not element names
    expect(toXml({ Req: { "@id": "1", "#text": "x", "a b": "y", Ok: "z" } })).toBe(`<?xml version="1.0" encoding="UTF-8"?><Req><Ok>z</Ok></Req>`);
  });
});
