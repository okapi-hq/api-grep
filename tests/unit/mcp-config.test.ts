import { describe, expect, it } from "vitest";
import { bridgeOf } from "../../src/lang/mcp-config/bridges.js";
import { ConfigParseError, readJson, readToml, type Value } from "../../src/lang/mcp-config/document.js";
import { isMcpConfigFile } from "../../src/lang/mcp-config/files.js";
import { valueParts } from "../../src/lang/mcp-config/placeholders.js";
import { transportKind, urlPathTransport } from "../../src/operation/mcp-transport.js";
import type { UrlShape } from "../../src/types.js";

const argv = (...words: string[]): Extract<Value, { kind: "string" }>[] => words.map((value) => ({ kind: "string", value }));

describe("MCP configuration bridges", () => {
  it("reads mcp-remote, supergateway and mcp-proxy through their runners", () => {
    const remote = bridgeOf(argv("pnpm", "dlx", "mcp-remote", "https://a.example.dev/mcp", "--transport", "http-only", "--header", "X-Key: k"));
    expect(remote).toMatchObject({ url: { value: "https://a.example.dev/mcp" }, kind: "streamable-http", headers: [{ value: "X-Key: k" }] });
    expect(bridgeOf(argv("mcp-remote", "https://a.example.dev/sse"))?.kind).toBeUndefined();
    expect(bridgeOf(argv("npx", "-y", "supergateway", "--streamableHttp", "https://b.example.dev/mcp"))).toMatchObject({ kind: "streamable-http" });
    const proxy = bridgeOf(argv("uvx", "mcp-proxy", "--headers", "Authorization", "Bearer t", "https://c.example.dev/sse"));
    expect(proxy).toMatchObject({ url: { value: "https://c.example.dev/sse" }, kind: "sse", pairs: [[{ value: "Authorization" }, { value: "Bearer t" }]] });
    expect(bridgeOf(argv("uvx", "mcp-proxy", "--transport=streamablehttp", "https://c.example.dev/mcp"))?.kind).toBe("streamable-http");
  });

  it("leaves out servers, other packages and bridges with no URL", () => {
    // supergateway serving a local command over SSE: its base URL is its own
    expect(bridgeOf(argv("npx", "-y", "supergateway", "--stdio", "node server.js", "--baseUrl", "http://localhost:8000"))).toBeUndefined();
    expect(bridgeOf(argv("npx", "-y", "@acme/files-mcp", "https://a.example.dev/mcp"))).toBeUndefined();
    expect(bridgeOf(argv("npx", "mcp-remote"))).toBeUndefined();
  });
});

describe("MCP configuration values", () => {
  it("reads env placeholders and VS Code inputs", () => {
    expect(valueParts("https://${env:HOST}/x?k=${KEY:-dev}&t={env:T}&u=${input:user}")).toEqual([
      { kind: "static", text: "https://" },
      { kind: "env", name: "HOST" },
      { kind: "static", text: "/x?k=" },
      { kind: "env", name: "KEY", fallback: "dev" },
      { kind: "static", text: "&t=" },
      { kind: "env", name: "T" },
      { kind: "static", text: "&u=" },
      { kind: "dynamic", name: "user", origin: "unknown" },
    ]);
  });

  it("reads JSON with comments and trailing commas, and refuses a file that does not parse", () => {
    const doc = readJson('{\n  // servers\n  "a": { "url": "https://a.example.dev", },\n}');
    expect(doc.root.kind === "object" && doc.root.entries.get("a")).toMatchObject({ kind: "object" });
    expect(() => readJson('{ "a": ')).toThrow(ConfigParseError);
    expect(() => readToml("[a\nb = ")).toThrow(ConfigParseError);
  });

  it("finds a TOML string after its server's table", () => {
    const text = 'url = "https://x.example.dev"\n[mcp_servers.x]\nurl = "https://x.example.dev"\n';
    const doc = readToml(text);
    expect(doc.locate({ kind: "string", value: "https://x.example.dev" }, "x")).toEqual({ line: 3, col: 7 });
  });

  it("knows the files by name and tool directory", () => {
    expect(["a/.mcp.json", ".cursor/mcp.json", ".gemini/settings.json", ".codex/config.toml", "opencode.jsonc"].every(isMcpConfigFile)).toBe(true);
    expect(["app/settings.json", "config.toml", "mcp.yaml"].some(isMcpConfigFile)).toBe(false);
  });
});

describe("MCP transports", () => {
  const url = (hostKind: UrlShape["hostKind"], pathTemplate: string): UrlShape => ({ hostKind, pathTemplate, query: [], queryShape: {}, dynamic: [], raw: "" });

  it("names the kind of a configuration's value", () => {
    expect(["sse", "http", "streamable_http", "streamable-http", "streamableHttp", "stdio", "remote"].map(transportKind)).toEqual([
      "sse",
      "streamable-http",
      "streamable-http",
      "streamable-http",
      "streamable-http",
      undefined,
      undefined,
    ]);
  });

  it("applies FastMCP's URL rule to URLs the code writes whole", () => {
    expect(urlPathTransport(url("literal", "/sse"))).toEqual({ kind: "sse" });
    expect(urlPathTransport(url("literal", "/sse/messages"))).toEqual({ kind: "sse" });
    expect(urlPathTransport(url("literal", "/mcp"))).toEqual({ kind: "streamable-http" });
    expect(urlPathTransport(url("literal", "/{path}"))).toBeUndefined();
    expect(urlPathTransport(url("env", "/mcp"))).toBeUndefined();
  });
});
