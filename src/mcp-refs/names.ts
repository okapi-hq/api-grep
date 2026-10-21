/**
 * MCP tool names written by the `mcp__<server>__<tool>` convention of coding agents. Names are normalized to
 * `[A-Za-z0-9_-]` and `__` separates the server from the tool, so a server's name holds no `__` (single `_` and `-`
 * are kept) and the tool is the rest of the name.
 */

/** A tool of a server (`tool` set), or the server as a whole or by a pattern (`mcp__github`, `mcp__github__*`). */
export interface ToolName {
  server: string;
  tool?: string;
}

const NAME_CHAR = "A-Za-z0-9_-";
// the server: name characters with no `__`; then `__` and the tool, possibly empty (a template, a pattern)
const REF = new RegExp(`(?<![${NAME_CHAR}])mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)(?:__([${NAME_CHAR}]*))?`, "g");

/** Characters that continue a name in a template (`mcp__${server}__…`, `mcp__github__{tool}`, `<tool>`, `%s`). */
const TEMPLATE_NEXT = new Set(["$", "{", "<", "%"]);

/** Names a documentation example or a template gives a server or a tool: no server's, no tool's. */
const PLACEHOLDERS = new Set([
  "server", "servername", "server_name", "server-name", "myserver", "my_server", "my-server",
  "tool", "toolname", "tool_name", "tool-name", "mytool", "my_tool", "my-tool", "xxx",
]);

const isPlaceholder = (name: string | undefined): boolean => name !== undefined && PLACEHOLDERS.has(name.toLowerCase());

/** The tool names written in a text, in order; placeholders, templates and `mcp__*` left out. */
export function toolNamesIn(text: string): ToolName[] {
  if (!text.includes("mcp__")) return [];
  const out: ToolName[] = [];
  for (const m of text.matchAll(REF)) {
    const server = m[1]!;
    const tool = m[2];
    const next = text[m.index + m[0].length] ?? "";
    if (TEMPLATE_NEXT.has(next) || isPlaceholder(server) || isPlaceholder(tool)) continue;
    if (next === "*") out.push({ server });
    else if (tool === undefined) out.push({ server });
    else if (tool !== "") out.push({ server, tool });
  }
  return out;
}
