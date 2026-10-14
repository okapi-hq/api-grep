import path from "node:path";
import { Node, SyntaxKind, type BindingElement, type Expression, type Project } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { declarationsOf } from "../ast/object.js";
import { readConfigFile } from "../files.js";
import { documentRoot } from "../resolve/graphql-source.js";

/**
 * ABIs imported from JSON files (#85): `import erc20Abi from "./erc20.json"`, a Hardhat or Foundry artifact's `abi`
 * (`import Token from "./Token.json"` then `Token.abi`, or `import { abi } from ...`), `require("./erc20.json")`. The
 * file is read within the scanned directory, as a config file is (small regular files only); its entries are what the
 * code would have written out.
 */

/** Entries read from one ABI: a bound on what the scanned repository makes the scan walk. */
const MAX_ENTRIES = 2000;

export interface AbiEntry {
  name: string;
  view: boolean;
}

const parsedBy = new WeakMap<Project, Map<string, unknown>>();

/** A JSON file of the scanned directory, parsed once per path and project; undefined when it cannot be read. */
function readJson(project: Project, file: string, root: string): unknown {
  let parsed = parsedBy.get(project);
  if (!parsed) parsedBy.set(project, (parsed = new Map<string, unknown>()));
  if (parsed.has(file)) return parsed.get(file);
  const text = readConfigFile(file, root);
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    value = undefined;
  }
  parsed.set(file, value);
  return value;
}

/** `import x from "./a.json"` / `import { abi } from "./a.json"`, `require("./a.json")`: the file and the key read. */
function importedJson(u: Expression): { file: string; key?: string } | undefined {
  const from = path.dirname(u.getSourceFile().getFilePath());
  if (Node.isCallExpression(u) && u.getExpression().getText() === "require") {
    const arg = u.getArguments()[0];
    const spec = arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : undefined;
    return spec?.startsWith(".") && spec.endsWith(".json") ? { file: path.resolve(from, spec) } : undefined;
  }
  const decl = declarationsOf(u)[0];
  if (decl && Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    return init && Node.isCallExpression(unwrap(init)) ? importedJson(unwrap(init)) : undefined;
  }
  // `const { abi } = require("./Token.json")`
  const owner = decl && Node.isBindingElement(decl) && !decl.getDotDotDotToken() ? decl.getParent().getParent() : undefined;
  if (owner && Node.isVariableDeclaration(owner)) {
    const init = owner.getInitializer();
    const file = init && Node.isCallExpression(unwrap(init)) ? importedJson(unwrap(init)) : undefined;
    const key = (decl as BindingElement).getPropertyNameNode()?.getText() ?? (decl as BindingElement).getName();
    return file && !file.key ? { file: file.file, key } : undefined;
  }
  if (!decl || (!Node.isImportClause(decl) && !Node.isImportSpecifier(decl))) return undefined;
  const spec = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
  if (!spec?.startsWith(".") || !spec.endsWith(".json")) return undefined;
  const key = Node.isImportSpecifier(decl) ? decl.getName() : undefined;
  return { file: path.resolve(from, spec), ...(key && key !== "default" ? { key } : {}) };
}

/** An ABI's entries: the array itself, or an artifact's `abi`. */
function abiOf(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value as unknown[];
  const abi = value && typeof value === "object" && Object.hasOwn(value, "abi") ? (value as { abi: unknown }).abi : undefined;
  return Array.isArray(abi) ? abi : undefined;
}

const VIEW = new Set(["view", "pure"]);

/** `{ type: "function", name, stateMutability }` (or the older `constant`), as `contract-abi` reads them in code. */
function entryOf(item: unknown): AbiEntry | undefined {
  if (!item || typeof item !== "object") return undefined;
  const { type, name, stateMutability, constant } = item as Record<string, unknown>;
  if (typeof name !== "string" || (type !== undefined && type !== "function")) return undefined;
  return { name, view: (typeof stateMutability === "string" && VIEW.has(stateMutability)) || constant === true };
}

/** The function entries of an ABI read from a JSON file `e` imports (also through `x.abi`); undefined for anything else. */
export function jsonAbi(e: Expression): AbiEntry[] | undefined {
  const u = unwrap(e);
  const owner = Node.isPropertyAccessExpression(u) ? unwrap(u.getExpression()) : u;
  const imported = Node.isIdentifier(owner) || Node.isCallExpression(owner) ? importedJson(owner) : undefined;
  const root = imported ? documentRoot(u.getProject()) : undefined;
  if (!imported || root === undefined) return undefined;
  let value = readJson(u.getProject(), imported.file, root);
  for (const key of [imported.key, Node.isPropertyAccessExpression(u) ? u.getName() : undefined]) {
    if (key !== undefined) value = value && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
  }
  const items = abiOf(value);
  return items?.slice(0, MAX_ENTRIES).flatMap((i) => entryOf(i) ?? []);
}
