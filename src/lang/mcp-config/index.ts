import { readConfigFile, relativePosix } from "../../files.js";
import type { Call } from "../../report/schema.js";
import { errorText, readEnvHints, SHARED_EXCLUDES } from "../files.js";
import type { LanguageFrontEnd, LanguageScanInput, LanguageScanResult } from "../types.js";
import { buildServerCall } from "./build.js";
import { ConfigParseError, readJson, readToml, type Document } from "./document.js";
import { mcpConfigFiles, mcpConfigLeftOut } from "./files.js";
import { declaredServers } from "./servers.js";
import { formatOf } from "./tools.js";

/**
 * MCP configuration files (`mcp-config`): the remote MCP servers coding agents and editors are configured to connect
 * to. Not a request the code sends, but a dependency on the server's URL all the same (a vendor retiring an endpoint
 * breaks it): each remote server is a call. Read as data, never run.
 */

/** A configuration file read as data; one that does not parse is a `ConfigParseError`. */
export function readDocument(file: string, rootDir: string): Document {
  const text = readConfigFile(file, rootDir);
  if (text === undefined) throw new Error("not a regular file of at most 4 MB");
  return file.endsWith(".toml") ? readToml(text) : readJson(text);
}

function scanFile(file: string, rel: string, input: LanguageScanInput, envHints: Record<string, string>): Call[] {
  const doc = readDocument(file, input.rootDir);
  const calls: Call[] = [];
  for (const decl of declaredServers(doc.root, formatOf(file))) {
    try {
      calls.push(...buildServerCall(decl, rel, doc, envHints));
    } catch (err) {
      input.diag.drop({ file: rel, line: doc.locate(decl.url, decl.name).line, reason: "internal-error", detail: errorText(err) });
    }
  }
  return calls;
}

function scanMcpConfig(input: LanguageScanInput): LanguageScanResult | undefined {
  const { rootDir, opts, diag } = input;
  const files = mcpConfigFiles(rootDir, opts.include, [...SHARED_EXCLUDES, ...(opts.exclude ?? [])]);
  const leftOut = mcpConfigLeftOut({ dir: rootDir, include: opts.include, exclude: opts.exclude }, new Set(files));
  if (files.length === 0 && leftOut.length === 0) return undefined;
  if (!input.changed) for (const l of leftOut) diag.skip(l);
  const selected = input.changed ? files.filter((f) => input.changed!.has(f)) : files;
  const envHints = readEnvHints(rootDir);
  const calls: Call[] = [];
  let scanned = 0;
  for (const file of selected) {
    const rel = relativePosix(rootDir, file);
    try {
      calls.push(...scanFile(file, rel, input, envHints));
      scanned++;
    } catch (err) {
      diag.skip({ file: rel, reason: err instanceof ConfigParseError ? "parse-error" : "internal-error", detail: errorText(err) });
    }
  }
  const seen = input.changed ? selected.length : files.length + leftOut.length;
  return { calls, files: { "mcp-config": { filesSeen: seen, filesScanned: scanned } }, coverage: [] };
}

/** MCP servers declared in coding agents' and editors' configuration files. */
export const mcpConfig: LanguageFrontEnd = { ids: ["mcp-config"], scan: (input) => Promise.resolve(scanMcpConfig(input)) };
