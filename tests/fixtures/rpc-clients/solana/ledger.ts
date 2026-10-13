import { Connection, sendAndConfirmTransaction, type Keypair, type PublicKey, type Transaction } from "@solana/web3.js";

const connection = new Connection("https://rpc.example-chain.net", "confirmed");

export async function balanceOf(owner: PublicKey) {
  return connection.getBalance(owner);
}

export async function parsedTransfer(signature: string) {
  return connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
}

export async function history(owner: PublicKey) {
  return connection.getSignaturesForAddress(owner, { limit: 20 });
}

export async function submit(tx: Transaction, payer: Keypair) {
  return sendAndConfirmTransaction(connection, tx, [payer]);
}

export async function slotOf(conn: Connection) {
  return conn.getSlot();
}
