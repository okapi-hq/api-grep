import { describe, expect, it } from "vitest";
import type { Report } from "../src/report/schema.js";
import { scanFixture } from "./fixture-helpers.js";

/** `file:line:col provider url [headers] transport` of each call, in report order. */
const servers = (r: Report): string[] =>
  r.calls.map((c) => `${c.location.file}:${c.location.line}:${c.location.col} ${c.provider} ${c.urlTemplate} [${c.headers.join(",")}] ${c.transport?.kind ?? "-"}`);

// the tools keep their files in dot directories: the whole fixture is scanned
const scanAll = () => scanFixture("mcp-config", { exclude: [], examples: 0 });

describe("MCP servers declared in configuration files", () => {

  it("reports each remote server and each bridge to one, at its URL", async () => {
    const r = await scanAll();
    expect(servers(r)).toEqual([
      ".codex/config.toml:4:7 mcp https://mcp.pantry-ledger.dev/mcp [x-region,authorization] streamable-http",
      ".codex/config.toml:10:40 mcp https://gateway.pantry-ledger.dev/sse [] sse",
      ".cursor/mcp.json:5:43 mcp https://mcp.drizzle-forecast.dev/sse [authorization] sse",
      ".cursor/mcp.json:9:14 mcp https://radar.drizzle-forecast.dev/mcp [x-api-key] -",
      ".gemini/settings.json:4:28 mcp https://mcp.fernway-travel.dev/mcp [authorization] streamable-http",
      ".gemini/settings.json:5:24 mcp https://legacy.fernway-travel.dev/sse [] sse",
      ".mcp.json:5:14 linear https://mcp.linear.app/mcp [authorization] streamable-http",
      ".mcp.json:10:14 mcp https://status.lanternworks.dev/sse [x-team] sse",
      ".mcp.json:15:14 mcp {env:DOCS_MCP_URL} [] streamable-http",
      ".vscode/mcp.json:6:14 mcp https://mcp.tallyhouse-crm.dev/mcp [authorization] streamable-http",
      ".vscode/mcp.json:11:14 mcp https://{tenant}.tallyhouse-crm.dev/sse [] sse",
      ".zed/settings.json:4:21 mcp https://mcp.nightowl-ops.dev/mcp [authorization] -",
      "cline_mcp_settings.json:3:24 mcp https://mcp.harbor-notes.dev/sse [] sse",
      "cline_mcp_settings.json:4:49 mcp https://tools.harbor-notes.dev/mcp [] streamable-http",
      "mcp_config.json:3:30 mcp https://mcp.burrowtrack.dev/mcp [x-api-key] -",
      "opencode.jsonc:7:14 mcp https://mcp.quillstack.dev/mcp [authorization] -",
      "opencode.jsonc:14:41 mcp https://search.quillstack.dev/mcp [] streamable-http",
    ]);
    expect(r.calls.every((c) => c.client === "mcp-config" && c.location.language === "mcp-config" && c.method === "POST")).toBe(true);
    expect(r.calls.every((c) => c.transport?.name === undefined)).toBe(true);
    expect(r.calls[0]!.operation).toEqual({ protocol: "mcp", name: "initialize", dynamic: false, from: "body" });
    const ids = r.calls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

});

describe("MCP configuration files: values, files and languages", () => {
  it("reads placeholders as env reads and inputs, keeps literal header values but credentials", async () => {
    const r = await scanAll();
    const at = (file: string, line: number) => r.calls.find((c) => c.location.file === file && c.location.line === line)!;
    expect(at(".mcp.json", 10).headerValues).toEqual({ "x-team": "platform" });
    expect(at(".mcp.json", 5)).toMatchObject({ authScheme: "bearer", headerValues: { authorization: null } });
    expect(at(".mcp.json", 15)).toMatchObject({ hostKind: "env", envName: "DOCS_MCP_URL", host: "docs.lanternworks.dev" });
    expect(at(".vscode/mcp.json", 11).dynamic).toEqual([{ where: "host", name: "tenant", origin: "unknown" }]);
    expect(at(".zed/settings.json", 4).headerValues).toEqual({ authorization: null });
    expect(at(".codex/config.toml", 4)).toMatchObject({ authScheme: "bearer", headerValues: { "x-region": "eu", authorization: null } });
  });

  it("counts the files, skips one that does not parse, ignores files of other tools", async () => {
    const r = await scanAll();
    expect(r.diagnostics?.languages["mcp-config"]).toEqual({ filesSeen: 11, filesScanned: 10 });
    expect(r.diagnostics?.skipped).toEqual([{ file: ".roo/mcp.json", reason: "parse-error", detail: "syntax error at line 5" }]);
    expect(r.calls.some((c) => c.location.file.startsWith("app/"))).toBe(false);
  });

  it("is a language of its own: --language mcp-config, and other languages without it", async () => {
    const only = await scanFixture("mcp-config", { exclude: [], examples: 0, languages: ["mcp-config"] });
    expect(only.calls).toHaveLength(17);
    const none = await scanFixture("mcp-config", { exclude: [], examples: 0, languages: ["python"] });
    expect(none.calls).toEqual([]);
  });
});
