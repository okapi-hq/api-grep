import { BrowserProvider, JsonRpcProvider } from "ethers";

const sessions: Record<string, BrowserProvider | JsonRpcProvider> = {};

// one of the entries is the browser wallet: what a call sends is not known to be an HTTP request
function sessionProvider(kind: string) {
  sessions[kind] ??= kind === "wallet" ? new BrowserProvider((window as any).ethereum) : new JsonRpcProvider(process.env.READER_RPC_URL);
  return sessions[kind];
}

export async function nonce(address: string) {
  return sessionProvider("reader").getTransactionCount(address);
}
