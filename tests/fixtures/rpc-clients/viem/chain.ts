import { createPublicClient, createWalletClient, custom, fallback, http, parseAbi } from "viem";
import { getBlockNumber } from "viem/actions";
import { mainnet } from "viem/chains";

const abi = parseAbi(["function totalSupply() view returns (uint256)"]);

export const reader = createPublicClient({ chain: mainnet, transport: http("https://eth.example-node.io/v1/demo") });

const failover = createPublicClient({ chain: mainnet, transport: fallback([http("https://a.example-node.io"), http("https://b.example-node.io")]) });

const wallet = createWalletClient({ chain: mainnet, transport: custom((window as any).ethereum) });

export async function balance(address: `0x${string}`) {
  return reader.getBalance({ address, blockTag: "safe" });
}

export async function supply(address: `0x${string}`) {
  return reader.readContract({ address, abi, functionName: "totalSupply" });
}

export async function gasPrice() {
  return failover.getGasPrice();
}

export async function chainId() {
  return reader.request({ method: "eth_chainId" });
}

export async function head() {
  return getBlockNumber(reader);
}

export async function accounts() {
  return wallet.getAddresses();
}
