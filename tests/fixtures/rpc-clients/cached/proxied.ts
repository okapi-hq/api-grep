import { Contract, JsonRpcProvider } from "ethers";

// a provider of the app that sends through its own backend
class ProxiedProvider extends JsonRpcProvider {
  constructor(chainId: number) {
    super("http://localhost", chainId);
  }
}

const pool: Record<number, JsonRpcProvider> = {};

export const poolProvider = (chainId: number): JsonRpcProvider => {
  if (!pool[chainId]) pool[chainId] = process.env.PRIVATE_RPC ? new ProxiedProvider(chainId) : new JsonRpcProvider("https://rpc.example-chain.net");
  return pool[chainId];
};

const VAULT_ABI = [{ type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [] }];

export async function assets(vault: string) {
  const reader = new Contract(vault, VAULT_ABI, poolProvider(1));
  return reader.totalAssets();
}
