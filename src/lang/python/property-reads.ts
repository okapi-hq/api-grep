import web3 from "./registry/web3.json" with { type: "json" };

/**
 * Attribute names a registry reads as requests (web3.py `w3.eth.block_number` sends `eth_blockNumber`, #78): the
 * lowering records reads of them as calls without arguments, which match those registry entries only.
 */
export const PROPERTY_READS: ReadonlySet<string> = new Set(
  Object.entries(web3.methods as Record<string, { property?: boolean }>).flatMap(([key, spec]) => (spec.property ? [key.split(".").at(-1)!] : [])),
);
