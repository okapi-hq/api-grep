import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_LISTED, mcpToolRefs } from "../src/mcp-refs/coverage.js";
import { fileKind } from "../src/mcp-refs/kinds.js";
import { toolNamesIn } from "../src/mcp-refs/names.js";
import { mcpToolRefsLine } from "../src/report/diagnostics.js";
import { FIXTURES, scanFixture } from "./fixture-helpers.js";

const FIXTURE = path.join(FIXTURES, "mcp-tool-refs");
const schema = JSON.parse(readFileSync(path.join(FIXTURES, "..", "..", "schema", "report.v1.json"), "utf8")) as Record<string, unknown>;

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repository of the given files in a temporary directory. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tool-refs-"));
  temps.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** Paths and the kind each is read as. */
const KINDS: Record<string, string> = {
  ".claude/settings.json": "settings",
  "app/.claude/settings.local.json": "settings",
  ".claude/agents/reviewer.md": "agent",
  ".claude/commands/deploy/run.md": "command",
  "plugins/notes/skills/append/SKILL.md": "skill",
  ".claude/skills/release/notes.md": "skill",
  "AGENTS.md": "instructions",
  "pkg/GEMINI.md": "instructions",
  ".github/copilot-instructions.md": "instructions",
  ".cursor/rules/tools.mdc": "instructions",
  ".windsurfrules": "instructions",
  ".github/workflows/review.yml": "workflow",
  "src/agent.py": "code",
  "docs/tools.md": "other",
  ".claude/hooks/check.json": "other",
};

describe("MCP tool names pinned in files", () => {
  it("counts each tool per file kind, and says which servers the configuration declares", async () => {
    // the tools keep their files in dot directories: the whole fixture is scanned
    const r = await scanFixture("mcp-tool-refs", { exclude: [], examples: 0 });
    expect(r.coverage?.mcpToolRefs).toEqual({
      files: 9,
      references: 14,
      pairs: 7,
      tools: [
        { server: "tracker", tool: "create_issue", references: 5, files: 5, kinds: ["settings", "agent", "instructions", "other"], declared: true, host: "mcp.tracker-hub.dev" },
        { server: "incident-desk", tool: "get_incident", references: 3, files: 2, kinds: ["workflow", "code"], declared: false },
        { server: "tracker", tool: "get_pull_request", references: 2, files: 2, kinds: ["agent", "workflow"], declared: true, host: "mcp.tracker-hub.dev" },
        { server: "forecast", tool: "get_outlook", references: 1, files: 1, kinds: ["command"], declared: false },
        { server: "local-files", tool: "delete_file", references: 1, files: 1, kinds: ["settings"], declared: true },
        { server: "team_notes", tool: "append", references: 1, files: 1, kinds: ["skill"], declared: true, host: "notes.quillfern.dev" },
        { server: "tracker", tool: "list_pulls", references: 1, files: 1, kinds: ["settings"], declared: true, host: "mcp.tracker-hub.dev" },
      ],
      servers: [
        { server: "forecast", references: 1, files: 1, kinds: ["settings"], declared: false },
        { server: "tracker", references: 1, files: 1, kinds: ["settings"], declared: true, host: "mcp.tracker-hub.dev" },
      ],
    });
    expect(new Ajv({ allErrors: true }).validate(schema, r)).toBe(true);
    expect(mcpToolRefsLine(r.coverage!.mcpToolRefs!)).toBe(
      "MCP tool names pinned in 9 files: 7 tools, 14 references; most: mcp__tracker__create_issue (5), mcp__incident-desk__get_incident (3), mcp__tracker__get_pull_request (2)",
    );
  });
});

describe("MCP tool names: reading names and file kinds", () => {
  it("reads names, server patterns, and leaves placeholders and templates out", () => {
    const text = [
      "allow mcp__tracker__create_issue, mcp__team_ai_Docs__read-page and mcp__tracker",
      "patterns mcp__tracker__* mcp__forecast__get_* mcp__forecast*",
      "never mcp__* nor mcp__server__tool nor mcp__Server_Name__run nor mcp__tracker__tool_name nor mcp__<server>__<tool>",
      "templates mcp__${name}__run mcp__tracker__${tool} mcp__tracker__{tool} mcp__tracker__get_%s mcp__tracker__ x_mcp__a__b",
    ].join("\n");
    expect(toolNamesIn(text)).toEqual([
      { server: "tracker", tool: "create_issue" },
      { server: "team_ai_Docs", tool: "read-page" },
      { server: "tracker" },
      { server: "tracker" },
      { server: "forecast" },
      { server: "forecast" },
    ]);
    expect(toolNamesIn("no names here")).toEqual([]);
  });

  it("tells the kind of a file by its path", () => {
    expect(Object.keys(KINDS).map(fileKind)).toEqual(Object.values(KINDS));
  });
});

describe("MCP tool names: files read and bounds", () => {
  it("skips dependencies, build output and excluded files", () => {
    const dir = repo({
      "CLAUDE.md": "Use mcp__tracker__create_issue.",
      "node_modules/agent-kit/README.md": "mcp__tracker__vendored_tool",
      "dist/agent.js": 'allowedTools: ["mcp__tracker__built_tool"]',
      "vendor/kit/AGENTS.md": "mcp__tracker__vendored_doc_tool",
      ".venv/lib/agent.py": 'allowed_tools=["mcp__tracker__venv_tool"]',
      "web/app.min.js": '"mcp__tracker__minified_tool"',
      "notes/todo.md": "mcp__tracker__excluded_tool",
      "logo.png": "mcp__tracker__binary_tool",
    });
    const r = mcpToolRefs(dir, { exclude: ["notes/**"] });
    expect(r.tools.map((t) => t.tool)).toEqual(["create_issue"]);
    expect(r).toMatchObject({ files: 1, references: 1, pairs: 1 });
    expect(mcpToolRefs(dir, { include: ["notes/**"] }).tools.map((t) => t.tool)).toEqual(["excluded_tool"]);
  });

  it("lists at most 200 tools, counting them all", () => {
    const names = Array.from({ length: MAX_LISTED + 5 }, (_, i) => `mcp__bulk__tool_${String(i).padStart(3, "0")}`);
    const r = mcpToolRefs(repo({ ".claude/settings.json": JSON.stringify({ permissions: { allow: names } }) }));
    expect(r).toMatchObject({ files: 1, references: MAX_LISTED + 5, pairs: MAX_LISTED + 5 });
    expect(r.tools).toHaveLength(MAX_LISTED);
    expect(r.tools[0]).toEqual({ server: "bulk", tool: "tool_000", references: 1, files: 1, kinds: ["settings"], declared: false });
  });

  it("is empty for a repository that pins none, and has no table line", () => {
    const r = mcpToolRefs(repo({ "README.md": "An MCP server: see mcp.json." }));
    expect(r).toEqual({ files: 0, references: 0, pairs: 0, tools: [], servers: [] });
    expect(mcpToolRefsLine(r)).toBeUndefined();
  });

  it("reads the whole fixture directly as the scan does", () => {
    expect(mcpToolRefs(FIXTURE).pairs).toBe(7);
  });
});
