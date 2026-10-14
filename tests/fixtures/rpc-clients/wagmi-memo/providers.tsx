import { useMemo, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { mainnet } from "wagmi/chains";

const NODE_URL = "https://eth.example-node.io/v1";

// the config is built in the component, once
export function Providers({ children }: { children: ReactNode }) {
  const config = useMemo(
    () =>
      createConfig({
        chains: [mainnet],
        transports: { [mainnet.id]: http(NODE_URL) },
      }),
    [],
  );
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
