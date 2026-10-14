import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useEffect, useState } from "react";

export function WalletPanel({ owner }: { owner: PublicKey }) {
  const { connection } = useConnection();
  const { sendTransaction } = useWallet();
  const [lamports, setLamports] = useState(0);

  useEffect(() => {
    connection.getBalance(owner).then(setLamports);
  }, [connection, owner]);

  async function send(tx: Transaction) {
    // signed and sent by the wallet
    const signature = await sendTransaction(tx, connection);
    return connection.confirmTransaction(signature, "confirmed");
  }

  return { lamports, send };
}

export function useSlot() {
  return useConnection().connection.getSlot();
}
