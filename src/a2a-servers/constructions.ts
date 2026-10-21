/**
 * What serves an A2A agent, per package: a file is read for these constructions only when it names the package's
 * module (`uses`), so a name such as `to_a2a` stands for the framework's and nothing else.
 */
export interface ServingPackage {
  package: string;
  /** Text a file using the package contains (its import path or module). */
  uses: RegExp;
  /** Constructions that serve an agent, by name as the code writes them. */
  names: string[];
  /** The package a file uses, from the `uses` match, when it names a major version (`a2a-go/v2`). */
  packageOf?: (used: RegExpExecArray) => string;
}

export const SERVING_PACKAGES: ServingPackage[] = [
  {
    package: "a2a-sdk",
    uses: /\ba2a\.server\b|\bfrom a2a\b/,
    names: ["A2AStarletteApplication", "A2AFastAPIApplication", "A2ARESTFastAPIApplication", "create_jsonrpc_routes", "create_rest_routes", "create_agent_card_routes", "add_a2a_routes_to_fastapi"],
  },
  { package: "@a2a-js/sdk", uses: /@a2a-js\/sdk\/server/, names: ["A2AExpressApp", "agentCardHandler", "jsonRpcHandler", "restHandler"] },
  { package: "google-adk", uses: /\bgoogle\.adk\.a2a\b/, names: ["to_a2a"] },
  { package: "strands-agents", uses: /\bstrands\.multiagent\.a2a\b/, names: ["A2AServer"] },
  { package: "fasta2a", uses: /\bfasta2a\b/, names: ["FastA2A"] },
  { package: "pydantic-ai", uses: /\bpydantic_ai\b/, names: ["to_a2a"] },
  { package: "crewai", uses: /\bcrewai\.a2a\b/, names: ["A2AServerConfig"] },
  { package: "bedrock-agentcore", uses: /\bbedrock_agentcore\b/, names: ["serve_a2a"] },
  {
    package: "github.com/a2aproject/a2a-go",
    uses: /(github\.com\/a2aproject\/a2a-go(?:\/v\d+)?)\/a2asrv/,
    packageOf: (used) => used[1]!,
    names: ["a2asrv.NewHandler", "a2asrv.NewJSONRPCHandler", "a2asrv.NewRESTHandler", "a2asrv.NewStaticAgentCardHandler", "a2asrv.NewAgentCardHandler"],
  },
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A construction's first use in `text` (a call, `new X(`, or a method `.to_a2a(`), as its 1-based line. */
export function firstConstruction(text: string, names: string[]): { name: string; line: number } | undefined {
  let best: { name: string; index: number } | undefined;
  for (const name of names) {
    const re = new RegExp(`(?<![\\w$])${escape(name)}\\s*\\(`, "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (isCommented(text, m.index)) continue;
      if (!best || m.index < best.index) best = { name, index: m.index };
      break;
    }
  }
  return best ? { name: best.name, line: lineAt(text, best.index) } : undefined;
}

/** Whether the line holding `index` is a comment before it (`#`, `//`, `*`). */
function isCommented(text: string, index: number): boolean {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  return /^\s*(#|\/\/|\*)/.test(text.slice(start, index));
}

export const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;
