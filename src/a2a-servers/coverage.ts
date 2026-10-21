import path from "node:path";
import { relativePosix } from "../files.js";
import { SHARED_EXCLUDES } from "../lang/files.js";
import { readText, textFiles } from "../mcp-refs/files.js";
import { CODE_EXTENSIONS } from "../mcp-refs/kinds.js";
import type { A2aServer, A2aServers } from "../report/schema-a2a-servers.js";
import { cardFactsInCode, cardFactsOfJson } from "./card-facts.js";
import { firstConstruction, SERVING_PACKAGES } from "./constructions.js";

/**
 * `coverage.a2aServers`: the A2A agents the repository serves, by the SDK and framework constructions of its source
 * files (one per file and package) and the agent cards it commits under `.well-known/`. Text only, no call.
 */

/** Agents listed in a report; `count` still counts every one. */
export const MAX_LISTED = 200;

/** A committed card's well-known path, from `.well-known/` on. */
const CARD_FILE = /(?:^|\/)(\.well-known\/agent(?:-card)?\.json)$/;

export interface A2aServerSelection {
  include?: string[];
  exclude?: string[];
}

/** The agents served in one source file: the first construction of each package whose module it names. */
function servedInCode(rel: string, text: string): A2aServer[] {
  const out: A2aServer[] = [];
  for (const pkg of SERVING_PACKAGES) {
    const used = pkg.uses.exec(text);
    if (!used) continue;
    const found = firstConstruction(text, pkg.names);
    const name = pkg.packageOf?.(used) ?? pkg.package;
    if (found) out.push({ file: rel, line: found.line, kind: "sdk", construction: found.name, package: name, card: cardFactsInCode(text) });
  }
  return out;
}

/** A committed agent card, when the file parses as one. */
function servedCard(rel: string, text: string): A2aServer | undefined {
  const at = CARD_FILE.exec(rel);
  if (!at) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  const card = cardFactsOfJson(data, `/${at[1]}`);
  return card ? { file: rel, line: 1, kind: "card-file", card } : undefined;
}

const isCode = (file: string): boolean => CODE_EXTENSIONS.some((e) => file.endsWith(e));

/** The served agents under `rootDir` in the files the selection keeps (shared excludes too). */
export function a2aServers(rootDir: string, sel: A2aServerSelection = {}): A2aServers {
  const exclude = [...SHARED_EXCLUDES, ...(sel.exclude ?? [])];
  const servers: A2aServer[] = [];
  for (const file of textFiles(rootDir, sel.include, exclude)) {
    const card = CARD_FILE.test(file.split(path.sep).join("/"));
    if (!card && !isCode(file)) continue;
    const text = readText(file);
    if (text === undefined) continue;
    const rel = relativePosix(rootDir, file);
    const served = card ? servedCard(rel, text) : undefined;
    if (served) servers.push(served);
    else if (!card && /a2a/i.test(text)) servers.push(...servedInCode(rel, text));
  }
  return { count: servers.length, servers: servers.slice(0, MAX_LISTED) };
}
