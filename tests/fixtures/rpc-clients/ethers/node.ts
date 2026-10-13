import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.ETH_NODE_URL);
const browser = new ethers.BrowserProvider((window as any).ethereum);
const legacy = new ethers.providers.StaticJsonRpcProvider("https://archive.example-node.io");

export async function balance(address: string) {
  return provider.getBalance(address);
}

export async function receipt(hash: string) {
  return provider.getTransactionReceipt(hash);
}

export async function feeHistory() {
  return provider.send("eth_feeHistory", [4, "latest", []]);
}

export async function oldBlock(tag: number) {
  return legacy.getBlock(tag);
}

export async function walletBalance(address: string) {
  return browser.getBalance(address);
}

export async function tokenBalance(token: ethers.Contract, address: string) {
  return token.getBalance(address);
}
