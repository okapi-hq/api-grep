import type { ToolRefKind } from "../report/schema.js";

/**
 * The kind of file a pinned MCP tool name is written in, by its path relative to the scanned directory (`/`
 * separated): where coding agents read tool names from, then code, then anything else.
 */

/** Kinds in report order (`ToolRefKindSchema`). */
export const KIND_ORDER: ToolRefKind[] = ["settings", "agent", "command", "skill", "instructions", "workflow", "code", "other"];

const INSTRUCTION_NAMES = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "GEMINI.md", ".cursorrules", ".windsurfrules", ".clinerules"]);
const INSTRUCTION_DIRS = ["/.cursor/rules/", "/.windsurf/rules/", "/.clinerules/", "/.github/instructions/"];

/** Extensions of the source files api-grep reads (and Ruby, whose agents name tools too). */
export const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".html",
  ".py", ".php", ".kt", ".kts", ".java", ".go", ".rs", ".dart", ".sh", ".bash", ".zsh", ".rb",
];

const under = (rel: string, dir: string): boolean => rel.includes(dir);

/** The kind of a file; `rel` is read with a leading `/` so a directory at the root matches like a nested one. */
export function fileKind(relPath: string): ToolRefKind {
  const rel = `/${relPath}`;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  if (under(rel, "/.claude/") && /^settings(\.[\w-]+)*\.json$/.test(name) && rel.endsWith(`/.claude/${name}`)) return "settings";
  if (under(rel, "/.claude/agents/")) return "agent";
  if (under(rel, "/.claude/commands/")) return "command";
  if (name === "SKILL.md" || under(rel, "/.claude/skills/")) return "skill";
  if (INSTRUCTION_NAMES.has(name) || rel.endsWith("/.github/copilot-instructions.md") || INSTRUCTION_DIRS.some((d) => under(rel, d))) return "instructions";
  if (under(rel, "/.github/workflows/")) return "workflow";
  if (CODE_EXTENSIONS.some((e) => name.endsWith(e))) return "code";
  return "other";
}
