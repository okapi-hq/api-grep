import { Node, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { getProp } from "../ast/object.js";
import { argsOf, calledName, MAX_DEPTH, valueOf } from "./endpoint.js";
import { jsonAbi, type AbiEntry } from "./json-abi.js";

/**
 * Whether a contract's function only reads (#78): what its ABI says when the code writes the ABI out, as human-readable
 * signatures (`"function balanceOf(address) view returns (uint256)"`) or JSON fragments (`{ name, stateMutability }`).
 * An ABI imported from a JSON file is read from it (#85); one built elsewhere says nothing: the call then lists what it
 * may send.
 */

/** Entries read from one ABI: a bound on what the scanned code makes the scan walk. */
const MAX_ENTRIES = 2000;
/** Calls that take an ABI and give it back in another form (`new Interface(abi)`, viem `parseAbi([...])`). */
const ABI_WRAPPERS = new Set(["Interface", "parseAbi"]);

const SIGNATURE = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/;

function stringValue(e: Expression | undefined): string | undefined {
  const u = e ? unwrap(e) : undefined;
  return u && (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) ? u.getLiteralValue() : undefined;
}

/** `function balanceOf(address owner) view returns (uint256)`: its name and whether it reads only. */
function fromSignature(text: string): [string, boolean] | undefined {
  const m = SIGNATURE.exec(text);
  if (!m) return undefined;
  const head = text.slice(m[0].length).split(/\breturns\b/)[0]!;
  return [m[1]!, /\b(?:view|pure|constant)\b/.test(head)];
}

/** `{ type: "function", name, stateMutability: "view" }`, or the older `constant: true`. */
function fromFragment(e: Expression): [string, boolean] | undefined {
  const name = stringValue(getProp(e, "name"));
  const type = stringValue(getProp(e, "type"));
  if (name === undefined || (type !== undefined && type !== "function")) return undefined;
  const mutability = stringValue(getProp(e, "stateMutability"));
  const constant = getProp(e, "constant");
  return [name, mutability === "view" || mutability === "pure" || (!!constant && unwrap(constant).getText() === "true")];
}

/** The ABI's entries as written in the code, or as read from the JSON file it is imported from (#85). */
type Abi = { items: Expression[] } | { entries: AbiEntry[] };

function abiArray(e: Expression | undefined, depth: number): Abi | undefined {
  if (!e || depth > MAX_DEPTH) return undefined;
  const u = unwrap(e);
  if (Node.isArrayLiteralExpression(u)) return { items: u.getElements() };
  const value = Node.isIdentifier(u) ? valueOf(u) : undefined;
  if (value) return abiArray(value, depth + 1);
  if ((Node.isCallExpression(u) || Node.isNewExpression(u)) && ABI_WRAPPERS.has(calledName(u) ?? "")) return abiArray(argsOf(u)[0], depth + 1);
  const entries = jsonAbi(u);
  return entries && { entries };
}

function entriesOf(abi: Abi): [string, boolean][] {
  if ("entries" in abi) return abi.entries.map((e) => [e.name, e.view]);
  return abi.items.slice(0, MAX_ENTRIES).flatMap((item) => {
    const u = unwrap(item);
    const text = stringValue(u);
    const entry = text !== undefined ? fromSignature(text) : Node.isObjectLiteralExpression(u) ? fromFragment(u) : undefined;
    return entry ? [entry] : [];
  });
}

/**
 * True when the ABI written in the code declares `name` as a view or pure function, false when it declares it as one
 * that writes, undefined when the ABI cannot be read or its overloads of `name` disagree. `name` may be a signature
 * (`balanceOf(address)`).
 */
export function readsOnly(abi: Expression | undefined, name: string): boolean | undefined {
  const read = abiArray(abi, 0);
  if (!read) return undefined;
  const wanted = name.split("(")[0]!;
  const found = new Set(entriesOf(read).flatMap(([n, view]) => (n === wanted ? [view] : [])));
  return found.size === 1 ? [...found][0] : undefined;
}
