import { z } from "zod";

/** MCP tool names pinned in the repository's files: a diagnostic of `coverage`, no call. */

export const ToolRefKindSchema = z
  .enum(["settings", "agent", "command", "skill", "instructions", "workflow", "code", "other"])
  .meta({
    id: "ToolRefKind",
    description:
      "The kind of file a pinned MCP tool name is written in, by its path: settings (`.claude/settings*.json`), agent (under `.claude/agents/`), command (under `.claude/commands/`), skill (a `SKILL.md`, or under `.claude/skills/`), instructions (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, under `.github/instructions/`, `.cursor/rules/`, `.windsurf/rules/` or `.clinerules/`, `.cursorrules`, `.windsurfrules`, `.clinerules`), workflow (under `.github/workflows/`), code (a source file of a language api-grep reads, or Ruby), other (anything else).",
  });

const refFields = {
  server: z.string().describe("The server's name as the reference writes it (`[A-Za-z0-9_-]`, no `__`)."),
  references: z.number().describe("Times it is written in the files read."),
  files: z.number().describe("Files it is written in."),
  kinds: z.array(ToolRefKindSchema).describe("Kinds of the files it is written in, each once, in the order of the enum."),
  declared: z
    .boolean()
    .describe(
      "A server of that name is declared in an MCP configuration file of the repository (the files the `mcp-config` language reads, local servers too), its name compared as coding agents write it in tool names: every character outside `[A-Za-z0-9_-]` read as `_`.",
    ),
  host: z.string().optional().describe("Host of the declared server's URL, lower case, when it is a remote server whose URL names a literal host."),
};

export const McpToolRefSchema = z
  .object({ ...refFields, tool: z.string().describe("The tool's name: what follows the server's `__`, up to the first character outside `[A-Za-z0-9_-]`.") })
  .meta({ id: "McpToolRef", description: "An MCP tool named by the `mcp__<server>__<tool>` convention." });

export const McpServerRefSchema = z
  .object(refFields)
  .meta({ id: "McpServerRef", description: "A reference to every tool of an MCP server, or to some of them by a pattern: `mcp__<server>`, `mcp__<server>__*`, `mcp__<server>__prefix*`." });

export const McpToolRefsSchema = z
  .object({
    files: z.number().describe("Files with at least one reference (a tool's or a server's)."),
    references: z.number().describe("References to a tool (`tools`), counting each time one is written."),
    pairs: z.number().describe("Distinct (server, tool) pairs referenced; `tools` lists at most 200 of them."),
    tools: z.array(McpToolRefSchema).describe("The tools referenced, by `references` (most first), then server and tool; at most 200."),
    servers: z.array(McpServerRefSchema).describe("The servers referenced as a whole or by a pattern, in the same order; at most 200."),
  })
  .meta({
    id: "McpToolRefs",
    description:
      "Since 1.29.0: MCP tool names pinned in the repository's text files by the `mcp__<server>__<tool>` convention of coding agents (permission lists, agents', commands' and skills' `tools`, instructions, CI workflows, code): names that break when a server renames or removes a tool. A measurement only: no call is reported for them. Placeholders (`mcp__server__tool`, a template's `mcp__${server}__…`) and `mcp__*` are left out.",
  });

export type McpToolRefs = z.infer<typeof McpToolRefsSchema>;
export type McpToolRef = z.infer<typeof McpToolRefSchema>;
export type McpServerRef = z.infer<typeof McpServerRefSchema>;
export type ToolRefKind = z.infer<typeof ToolRefKindSchema>;
