import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { soapClientOperation } from "../../src/operation/soap.js";
import { soapEndpoint, withoutWsdlQuery, wsdlOperation } from "../../src/resolve/soap-endpoint.js";
import { parseWsdl } from "../../src/resolve/wsdl.js";
import type { Part } from "../../src/types.js";

const text = (t: string): Part[] => [{ kind: "static", text: t }];
const wsdl = (body: string): string => `<?xml version="1.0"?><definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">${body}</definitions>`;
const dirs: string[] = [];

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-wsdl-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("parseWsdl", () => {
  it("reads the operations and the one address the ports declare", () => {
    const w = parseWsdl(wsdl(`<portType><operation name="Track"/></portType><service><port><soap:address location="https://ws.example.com/svc"/></port><port><soap12:address location="https://ws.example.com/svc"/></port></service>`));
    expect(w?.address).toBe("https://ws.example.com/svc");
    expect([...(w?.operations.values() ?? [])]).toEqual(["Track"]);
  });

  it("no address when the ports disagree or name no http(s) URL; WSDL 2.0 endpoints", () => {
    expect(parseWsdl(wsdl(`<soap:address location="https://a.example.com/"/><soap:address location="https://b.example.com/"/>`))?.address).toBeUndefined();
    expect(parseWsdl(wsdl(`<operation name="A"/><soap:address location="file:///etc/x"/>`))?.address).toBeUndefined();
    expect(parseWsdl(wsdl(`<endpoint name="e" address="https://c.example.com/x"/>`))?.address).toBe("https://c.example.com/x");
  });

  it("never expands a DTD entity and skips comments", () => {
    const doc = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY h SYSTEM "file:///etc/passwd">]><d><!-- <soap:address location="https://c.example.com/"/> --><soap:address location="https://&h;/x"/></d>`;
    expect(parseWsdl(doc)).toBeUndefined();
  });

  it("nothing from a text that is not a WSDL", () => {
    expect(parseWsdl("not xml at all")).toBeUndefined();
    expect(parseWsdl(`<a>${"<b>".repeat(10)}`)).toBeUndefined();
  });
});

describe("SOAP client endpoints", () => {
  it("drops the query asking for the WSDL", () => {
    expect(withoutWsdlQuery(text("https://ws.example.com/track?wsdl"))).toEqual(text("https://ws.example.com/track"));
    expect(withoutWsdlQuery(text("https://ws.example.com/t.svc?singleWsdl"))).toEqual(text("https://ws.example.com/t.svc"));
    expect(withoutWsdlQuery(text("https://ws.example.com/t?WSDL&v=2"))).toEqual(text("https://ws.example.com/t?v=2"));
    expect(withoutWsdlQuery(text("https://ws.example.com/t?v=2"))).toEqual(text("https://ws.example.com/t?v=2"));
  });

  it("a WSDL file gives its address; a missing one, or one outside the repository, an unknown host", () => {
    const outside = repo({ "x.wsdl": wsdl(`<soap:address location="https://internal.example.com/"/>`) });
    const dir = repo({ "app/svc.wsdl": wsdl(`<operation name="Track"/><soap:address location="https://ws.example.com/soap"/>`) });
    symlinkSync(path.join(outside, "x.wsdl"), path.join(dir, "app", "leak.wsdl"));
    const file = path.join(dir, "app", "main.php");
    const at = (wsdlRef: Part[]) => soapEndpoint({ wsdl: wsdlRef, file, rootDir: dir }, {});
    expect(at(text("svc.wsdl")).url).toMatchObject({ host: "ws.example.com", pathTemplate: "/soap" });
    expect(at([{ kind: "dynamic", name: "__DIR__", origin: "unknown" }, ...text("/svc.wsdl")]).url).toMatchObject({ host: "ws.example.com" });
    for (const ref of ["leak.wsdl", "missing.wsdl", path.join(outside, "x.wsdl"), "/dev/zero"]) {
      expect(at(text(ref)).url, ref).toMatchObject({ hostKind: "unknown" });
    }
    expect(wsdlOperation("track", at(text("svc.wsdl")).wsdl)).toBe("Track");
    expect(wsdlOperation("Other", at(text("svc.wsdl")).wsdl)).toBeUndefined();
    expect(wsdlOperation("Other", undefined)).toBe("Other");
  });

  it("the address the code gives wins", () => {
    const r = soapEndpoint({ wsdl: text("https://ws.example.com/t?wsdl"), location: text("https://eu.example.com/t"), file: "/x/a.php", rootDir: "/x" }, {});
    expect(r.url).toMatchObject({ host: "eu.example.com" });
    expect(soapEndpoint({ file: "/x/a.php", rootDir: "/x" }, {}).url.hostKind).toBe("unknown");
  });

  it("the operation: a name, a computed one, alternatives", () => {
    expect(soapClientOperation("Track")).toEqual({ protocol: "soap", name: "Track", dynamic: false, from: "body" });
    expect(soapClientOperation({ type: "union", anyOf: [{ type: "string", enum: ["A"] }, { type: "string", enum: ["B"] }] })).toMatchObject({ name: "A", alternatives: ["A", "B"] });
    expect(soapClientOperation(undefined)).toMatchObject({ name: null, dynamic: true });
  });
});
