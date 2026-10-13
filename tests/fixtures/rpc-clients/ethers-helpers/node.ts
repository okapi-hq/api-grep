import { JsonRpcProvider, type Provider } from "ethers";

export const node = new JsonRpcProvider("https://eth.example-node.io/rpc");

function rpc(method: string, params: unknown[]) {
  return node.send(method, params);
}

export const head = () => rpc("eth_blockNumber", []);

export const peers = () => rpc("net_peerCount", []);

export async function codeAt(provider: Provider, address: string) {
  return provider.getCode(address);
}
