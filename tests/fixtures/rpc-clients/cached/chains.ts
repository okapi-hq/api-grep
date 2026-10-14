import { Contract, JsonRpcProvider } from "ethers";

const RPC_URLS: Record<number, string> = {
  1: "https://eth.example-node.io/v1",
  10: "https://op.example-node.io/v1",
};

const providers: Record<number, JsonRpcProvider> = {};

// one provider per chain, built on first use: which one depends on the chain id
export function getProvider(chainId: number) {
  if (!providers[chainId]) providers[chainId] = new JsonRpcProvider(RPC_URLS[chainId], chainId);
  return providers[chainId];
}

const ERC20_ABI = ["function totalSupply() view returns (uint256)"];

export async function supply(token: string, chainId: number) {
  return new Contract(token, ERC20_ABI, getProvider(chainId)).totalSupply();
}

export async function head(chainId: number) {
  const provider = getProvider(chainId);
  return provider.getBlockNumber();
}
