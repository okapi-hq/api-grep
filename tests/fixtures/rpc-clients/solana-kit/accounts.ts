import { address, createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

const rpc = createSolanaRpc("https://rpc.example-chain.net");

export async function lamports(owner: string) {
  const { value } = await rpc.getBalance(address(owner)).send();
  return value;
}

export async function epoch() {
  return rpc.getEpochInfo({ commitment: "confirmed" }).send();
}

export async function account(client: Rpc<SolanaRpcApi>, key: string) {
  return client.getAccountInfo(address(key), { encoding: "base64" }).send();
}
