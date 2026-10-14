import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "./config";

export function App({ children }: { children: ReactNode }) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
