import type { McpTransport } from "../../types.js";
import type { Value } from "./document.js";

/**
 * A local (stdio) server is no call, unless it is a bridge to a remote server: `mcp-remote <url>`, `supergateway --sse
 * <url>` / `--streamableHttp <url>`, `mcp-proxy <url>`, run directly or through a package runner (`npx -y`, `bunx`,
 * `pnpm dlx`, `uvx`). The remote URL, the transport the bridge's options fix and the headers they add are the call's.
 */

type StringValue = Extract<Value, { kind: "string" }>;
type Kind = McpTransport["kind"];

export interface Bridge {
  url: StringValue;
  kind?: Kind;
  /** `Name: value` header arguments. */
  headers: StringValue[];
  /** Header arguments given as a name and a value (`mcp-proxy -H Name value`). */
  pairs: [StringValue, StringValue][];
}

/** Commands that run a package (`npx -y`, `pnpm dlx`, `npm exec --`); their options before the package name are skipped. */
const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx", "pnpm", "npm", "yarn"]);
const RUNNER_WORDS = new Set(["dlx", "exec", "run"]);
const PACKAGE = /^(?:@[^/\s]+\/)?(mcp-remote|supergateway|mcp-proxy)(?:@[^\s]*)?$/;
const URL = /^https?:\/\//i;
const MAX_ARGS = 64;

/** The bridge package an argument list runs, and the arguments after it. */
function bridgeArgs(argv: StringValue[]): { pkg: string; args: StringValue[] } | undefined {
  for (let i = 0; i < Math.min(argv.length, 8); i++) {
    const word = argv[i]!.value.split(/[\\/]/).at(-1)!;
    const m = PACKAGE.exec(word);
    if (m) return { pkg: m[1]!, args: argv.slice(i + 1, MAX_ARGS) };
    const beforePackage = i === 0 ? RUNNERS.has(word) : word.startsWith("-") || RUNNER_WORDS.has(word);
    if (!beforePackage) return undefined;
  }
  return undefined;
}

const MCP_REMOTE_KINDS: Record<string, Kind> = { "sse-only": "sse", "http-only": "streamable-http" };

function mcpRemote(args: StringValue[]): Bridge | undefined {
  const url = args.find((a) => URL.test(a.value));
  if (!url) return undefined;
  const option = (name: string): StringValue[] => args.flatMap((a, i) => (a.value === name && args[i + 1] ? [args[i + 1]!] : []));
  const transport = option("--transport")[0]?.value;
  const kind = transport !== undefined && Object.hasOwn(MCP_REMOTE_KINDS, transport) ? MCP_REMOTE_KINDS[transport] : undefined;
  return { url, kind, headers: option("--header"), pairs: [] };
}

/** supergateway connects to a remote server given after `--sse` or `--streamableHttp`; without one it is a server. */
function supergateway(args: StringValue[]): Bridge | undefined {
  const i = args.findIndex((a, j) => (a.value === "--sse" || a.value === "--streamableHttp") && URL.test(args[j + 1]?.value ?? ""));
  if (i < 0) return undefined;
  const headers = args.flatMap((a, j) => (a.value === "--header" && args[j + 1] ? [args[j + 1]!] : []));
  return { url: args[i + 1]!, kind: args[i]!.value === "--sse" ? "sse" : "streamable-http", headers, pairs: [] };
}

/** mcp-proxy given a URL is a client of it; its transport is SSE unless `--transport streamablehttp` says otherwise. */
function mcpProxy(args: StringValue[]): Bridge | undefined {
  const url = args.find((a) => URL.test(a.value));
  if (!url) return undefined;
  const at = args.findIndex((a) => a.value === "--transport" || a.value.startsWith("--transport="));
  const value = at < 0 ? "sse" : args[at]!.value.includes("=") ? args[at]!.value.split("=")[1] : args[at + 1]?.value;
  const kind: Kind | undefined = value === "sse" ? "sse" : value === "streamablehttp" ? "streamable-http" : undefined;
  const pairs = args.flatMap((a, j): [StringValue, StringValue][] => ((a.value === "-H" || a.value === "--headers") && args[j + 2] ? [[args[j + 1]!, args[j + 2]!]] : []));
  return { url, kind, headers: [], pairs };
}

/** The remote server a local command bridges to, if it runs a known bridge with a URL. */
export function bridgeOf(argv: StringValue[]): Bridge | undefined {
  const found = bridgeArgs(argv);
  if (!found) return undefined;
  if (found.pkg === "mcp-remote") return mcpRemote(found.args);
  if (found.pkg === "supergateway") return supergateway(found.args);
  return mcpProxy(found.args);
}
