import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createConfig, fallback, http, usePublicClient, WagmiProvider, type Config } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const IS_TEST = process.env.NEXT_PUBLIC_TEST === "true";

const testConfig = createConfig({ chains: [sepolia], transports: { [sepolia.id]: http("https://sepolia.example-node.io") } });
const liveConfig = createConfig({ chains: [mainnet], transports: { [mainnet.id]: http("https://eth.example-node.io") } });

// the app picks its config at build time: the node depends on the build
const appConfig = IS_TEST ? testConfig : liveConfig;

const ReaderContext = createContext<{ readerConfig: Config; readerClient: unknown } | null>(null);

export const useReader = () => {
  const value = useContext(ReaderContext);
  if (!value) throw new Error("useReader outside Web3Provider");
  return value;
};

export function Web3Provider({ backendUrl, children }: { backendUrl: string; children: ReactNode }) {
  // a reader of its own on mainnet: the app's backend first, then wagmi's public node
  const readerConfig = useMemo(
    () => createConfig({ chains: [mainnet], transports: { [mainnet.id]: fallback([http(backendUrl), http()]) } }),
    [backendUrl],
  );
  const readerClient = usePublicClient({ config: readerConfig });
  return (
    <ReaderContext.Provider value={{ readerConfig, readerClient }}>
      <WagmiProvider config={appConfig}>{children}</WagmiProvider>
    </ReaderContext.Provider>
  );
}
