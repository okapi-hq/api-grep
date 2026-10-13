import { getAccount, getAssociatedTokenAddress, getMint, transfer } from "@solana/spl-token";
import { Connection, type Keypair, type PublicKey } from "@solana/web3.js";

const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=demo");

export async function tokenBalance(owner: PublicKey, mint: PublicKey) {
  const address = await getAssociatedTokenAddress(mint, owner);
  const account = await getAccount(connection, address);
  return account.amount;
}

export async function decimals(conn: Connection, mint: PublicKey) {
  return (await getMint(conn, mint)).decimals;
}

export async function pay(payer: Keypair, from: PublicKey, to: PublicKey, amount: bigint) {
  return transfer(connection, payer, from, to, payer, amount);
}
