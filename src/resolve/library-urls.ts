import { Node, type CallExpression } from "ts-morph";
import { memberChain } from "../ast/expr.js";
import { identifierOrigin } from "../ast/origin.js";

/** Clusters `clusterApiUrl` knows; anything else throws at run time. */
const SOLANA_CLUSTERS = new Set(["devnet", "testnet", "mainnet-beta"]);

/**
 * A URL a library function returns for literal arguments: @solana/web3.js `clusterApiUrl("mainnet-beta")` is
 * `https://api.mainnet-beta.solana.com` (`http://` when its second argument is `false`; `devnet` by default).
 */
export function libraryUrl(call: CallExpression): string | undefined {
  const mc = memberChain(call.getExpression());
  if (!Node.isIdentifier(mc.root)) return undefined;
  const origin = identifierOrigin(mc.root);
  if (origin.kind !== "package" || origin.package !== "@solana/web3.js") return undefined;
  const name = mc.chain.length === 0 ? origin.importedName : mc.chain.length === 1 ? mc.chain[0] : undefined;
  if (name !== "clusterApiUrl") return undefined;
  const [cluster, tls] = call.getArguments();
  const value = cluster === undefined ? "devnet" : Node.isStringLiteral(cluster) || Node.isNoSubstitutionTemplateLiteral(cluster) ? cluster.getLiteralValue() : undefined;
  if (value === undefined || !SOLANA_CLUSTERS.has(value)) return undefined;
  if (tls !== undefined && !Node.isTrueLiteral(tls) && !Node.isFalseLiteral(tls)) return undefined;
  return `${tls && Node.isFalseLiteral(tls) ? "http" : "https"}://api.${value}.solana.com`;
}
