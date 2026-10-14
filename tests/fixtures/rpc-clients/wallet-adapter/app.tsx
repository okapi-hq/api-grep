import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";

const RPC_ENDPOINT = "https://solana.example-node.io/rpc";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]}>{children}</WalletProvider>
    </ConnectionProvider>
  );
}
