import * as web3 from "@solana/web3.js";

const devnet = new web3.Connection(web3.clusterApiUrl("devnet"), "confirmed");

export async function drip(to: web3.PublicKey) {
  return devnet.requestAirdrop(to, web3.LAMPORTS_PER_SOL);
}

export async function rent(size: number) {
  return new web3.Connection(web3.clusterApiUrl("mainnet-beta")).getMinimumBalanceForRentExemption(size);
}
