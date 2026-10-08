import { describe, expect, it } from "vitest";
import { exampleToCurl, toCurl } from "../../src/report/curl.js";
import type { Call, Example, Report } from "../../src/report/schema.js";

const ex = (over: Partial<Example> = {}): Example => ({ variant: "minimal", method: "GET", url: "https://api.example.com/v1/x", headers: {}, query: {}, bodyEncoding: "none", ...over });

const call = (over: Partial<Call> = {}): Call => ({
  id: "c1",
  location: { file: "src/a.ts", line: 3, col: 5, language: "typescript" },
  client: "fetch",
  provider: "api.example.com",
  hostKind: "literal",
  host: "api.example.com",
  method: "GET",
  pathTemplate: "/v1/x",
  urlTemplate: "https://api.example.com/v1/x",
  query: [],
  headers: [],
  headerValues: {},
  authScheme: "none",
  bodyEncoding: "none",
  dynamic: [],
  confidence: 0.9,
  findings: [],
  examples: [ex()],
  ...over,
});

const report = (calls: Call[]): Report => ({
  $schema: "https://example.com/schema.json",
  schemaVersion: "1.0.0",
  tool: "apicalls",
  version: "0.0.0",
  calls,
  stats: { filesScanned: 1, callsFound: calls.length, byLanguage: {}, byClient: {}, byProvider: {}, byHostKind: {}, withBodyShape: 0, withDynamic: 0, withFindings: 0, redacted: 0, durationMs: 0 },
});

describe("exampleToCurl method", () => {
  it("leaves an upper-case token method unquoted", () => {
    expect(exampleToCurl(ex({ method: "PROPFIND" }))).toBe("curl -X PROPFIND 'https://api.example.com/v1/x'");
  });

  it("quotes any other method as one shell word", () => {
    expect(exampleToCurl(ex({ method: "GET;touch x" }))).toBe("curl -X 'GET;touch x' 'https://api.example.com/v1/x'");
    expect(exampleToCurl(ex({ method: "GET\nX" }))).toBe("curl -X 'GET\\u000aX' 'https://api.example.com/v1/x'");
    expect(exampleToCurl(ex({ method: "get" }))).toBe("curl -X 'get' 'https://api.example.com/v1/x'");
    expect(exampleToCurl(ex({ method: "" }))).toBe("curl -X '' 'https://api.example.com/v1/x'");
  });
});

describe("exampleToCurl quoting", () => {
  it("escapes single quotes in the URL and headers", () => {
    const out = exampleToCurl(ex({ url: "https://h.com/it's", headers: { "x-note": "a'b" } }));
    expect(out).toBe("curl -X GET 'https://h.com/it'\\''s' \\\n  -H 'x-note: a'\\''b'");
  });

  it("keeps every argument on its own continuation line", () => {
    const out = exampleToCurl(ex({ url: "https://h.com/x\n$(id)", headers: { "x-a": "1\r\nInjected: yes" } }));
    expect(out.split("\n")).toEqual(["curl -X GET 'https://h.com/x\\u000a$(id)' \\", "  -H 'x-a: 1\\u000d\\u000aInjected: yes'"]);
  });
});

describe("exampleToCurl body", () => {
  it("sends json with --data", () => {
    expect(exampleToCurl(ex({ method: "POST", body: { a: 1 }, bodyEncoding: "json" }))).toBe(`curl -X POST 'https://api.example.com/v1/x' \\\n  --data '{"a":1}'`);
  });

  it("sends raw bodies with --data-raw so @ is never a file", () => {
    const out = exampleToCurl(ex({ method: "POST", body: "@/etc/passwd", bodyEncoding: "raw" }));
    expect(out).toContain("--data-raw '@/etc/passwd'");
    expect(out).not.toMatch(/--data '/);
    expect(exampleToCurl(ex({ method: "POST", body: { a: 1 }, bodyEncoding: "raw" }))).toContain(`--data-raw '{"a":1}'`);
  });

  it("sends multipart fields with --form-string so @ is never a file", () => {
    const out = exampleToCurl(ex({ method: "POST", body: { file: "@/etc/passwd", meta: { a: 1 } }, bodyEncoding: "multipart" }));
    expect(out).toContain("--form-string 'file=@/etc/passwd'");
    expect(out).toContain(`--form-string 'meta={"a":1}'`);
    expect(out).not.toMatch(/(^|\s)(-F|--form) /);
  });

  it("url-encodes form fields one by one", () => {
    const out = exampleToCurl(ex({ method: "POST", body: { q: "a b", n: 2, nil: null }, bodyEncoding: "form" }));
    expect(out.split(" \\\n  ").slice(1)).toEqual(["--data-urlencode 'q=a b'", "--data-urlencode 'n=2'", "--data-urlencode 'nil=null'"]);
  });

  it("wraps a non-object form body in a body field", () => {
    expect(exampleToCurl(ex({ method: "POST", body: "x", bodyEncoding: "form" }))).toContain("--data-urlencode 'body=x'");
  });

  it("omits the body when there is none", () => {
    expect(exampleToCurl(ex({ method: "POST", body: { a: 1 }, bodyEncoding: "none" }))).not.toContain("--data");
    expect(exampleToCurl(ex({ method: "POST", bodyEncoding: "json" }))).not.toContain("--data");
  });
});

describe("toCurl", () => {
  it("renders a commented header and one block per example", () => {
    const out = toCurl(report([call({ via: "wrapper:api", examples: [ex(), ex({ variant: "full" })] })]), 0);
    expect(out).toBe(
      "# src/a.ts:3 (typescript)  api.example.com GET /v1/x via wrapper:api  (confidence 0.90)\n" +
        "# minimal\ncurl -X GET 'https://api.example.com/v1/x'\n" +
        "# full\ncurl -X GET 'https://api.example.com/v1/x'\n",
    );
  });

  it("skips calls below the confidence threshold", () => {
    const out = toCurl(report([call({ id: "lo", confidence: 0.2, pathTemplate: "/low" }), call({ id: "hi", pathTemplate: "/high" })]), 0.5);
    expect(out).not.toContain("/low");
    expect(out).toContain("/high");
    expect(toCurl(report([]), 0)).toBe("\n");
  });

  it("keeps the header on one line whatever the scanned code put in it", () => {
    const c = call({
      location: { file: "src/a\nrm -rf ~.ts", line: 1, col: 1, language: "typescript" },
      pathTemplate: "/x\n/y",
      provider: "evil\u001b]0;pwned\u0007",
      via: "wrapper:a\u202eb",
    });
    const lines = toCurl(report([c]), 0).split("\n");
    expect(lines[0]).toBe("# src/a\\u000arm -rf ~.ts:1 (typescript)  evil\\u001b]0;pwned\\u0007 GET /x\\u000a/y via wrapper:a\\u202eb  (confidence 0.90)");
    expect(lines[1]).toBe("# minimal");
  });
});
