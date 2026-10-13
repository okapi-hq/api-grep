import { Node, SyntaxKind, type Expression } from "ts-morph";
import { isUndefinedLiteral, unwrap } from "../ast/expr.js";
import type { VendorSource } from "../types.js";
import { at, MAX_DEPTH, valueOf, type Endpoint } from "./endpoint.js";

/**
 * Clients of a node vendor (#78): ethers' `new InfuraProvider("sepolia", projectId)` sends to
 * `https://sepolia.infura.io/v3/<projectId>`, as the library's own table says (the registry copies it). A network the
 * table does not list, or one the scan cannot read, keeps the vendor's domain with the subdomain unknown
 * (`{network}.infura.io`): the vendor is known, its host is not guessed.
 */

/** Chain ids the code may give for a network (`new AlchemyProvider(1, key)`), by the name the tables use. */
const CHAIN_IDS: Record<string, string> = { "1": "mainnet", "5": "goerli", "10": "optimism", "137": "matic", "8453": "base", "42161": "arbitrum", "11155111": "sepolia" };

/** A network given as a literal (also through a constant): its name; undefined when not literal. */
function networkName(e: Expression, depth = 0): string | undefined {
  const u = unwrap(e);
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralValue();
  if (Node.isNumericLiteral(u)) return CHAIN_IDS[u.getLiteralValue().toString()];
  const value = Node.isIdentifier(u) && depth < MAX_DEPTH ? valueOf(u) : undefined;
  return value ? networkName(value, depth + 1) : undefined;
}

export function vendorEndpoint(vendor: VendorSource, args: Expression[]): Endpoint {
  const given = at(args, vendor.network);
  const unset = !given || isUndefinedLiteral(given) || unwrap(given).getKind() === SyntaxKind.NullKeyword;
  const name = unset || !given ? vendor.default : networkName(given);
  const host = name !== undefined && Object.hasOwn(vendor.hosts, name) ? vendor.hosts[name]! : vendor.host;
  return { host, path: vendor.path };
}

/** The literal start of a string (`"https://..."`, `` `https://${host}` ``), also through a constant. */
function literalStart(e: Expression, depth = 0): string | undefined {
  const u = unwrap(e);
  if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralValue();
  if (Node.isTemplateExpression(u)) return u.getHead().getLiteralText() || undefined;
  const value = Node.isIdentifier(u) && depth < MAX_DEPTH ? valueOf(u) : undefined;
  return value ? literalStart(value, depth + 1) : undefined;
}

/**
 * ethers `getDefaultProvider(network)`: a JsonRpcProvider for an `http(s)` URL, a socket for a `ws(s)` one (null), else
 * a mix of vendors' backends, or a value that may be either: hosts not known (an empty endpoint).
 */
export function urlOrNetwork(given: Expression | undefined): Endpoint | null {
  const text = given ? literalStart(given) : undefined;
  if (text !== undefined && /^wss?:/i.test(text)) return null;
  return text !== undefined && /^https?:/i.test(text) ? { url: given } : {};
}
