import { BrowserProvider, JsonRpcProvider } from "ethers";

const READER_URL = "https://reader.example-node.io/rpc";
const readers: Record<number, JsonRpcProvider> = {};

// every chain is read through the same node
export function getReader(chainId: number): JsonRpcProvider {
  if (!readers[chainId]) readers[chainId] = new JsonRpcProvider(READER_URL, chainId);
  return readers[chainId];
}

const ARCHIVE_URLS: Record<number, string> = { 1: "https://archive.example-node.io/eth", 10: "https://archive.example-node.io/op" };
const archives: Record<number, JsonRpcProvider> = {};

export const getArchive = (chainId: number): JsonRpcProvider => {
  archives[chainId] ??= new JsonRpcProvider(ARCHIVE_URLS[chainId], chainId);
  return archives[chainId];
};

export const getWallet = (_chainId: number) => new BrowserProvider((window as any).ethereum);
