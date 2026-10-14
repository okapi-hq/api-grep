import type { ReactNode } from "react";
import { createConfig, http, usePublicClient, useReadContract, WagmiProvider } from "wagmi";
import { mainnet } from "wagmi/chains";
import { getDefaultConfig } from "@example/wallet-kit";

// the app's config comes from another library, which may route reads through the connected wallet
const appConfig = getDefaultConfig({ appName: "Vaults", chains: [mainnet] });

// a reader of its own, used by name
const readerConfig = createConfig({ chains: [mainnet], transports: { [mainnet.id]: http("https://reader.example-node.io/rpc") } });

export function Providers({ children }: { children: ReactNode }) {
  return <WagmiProvider config={appConfig}>{children}</WagmiProvider>;
}

const abi = [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }] as const;

export function useSupply(token: `0x${string}`) {
  // through the app's config: not known to be an HTTP request
  const supply = useReadContract({ address: token, abi, functionName: "totalSupply" });
  const reader = usePublicClient({ config: readerConfig });
  const head = reader?.getBlockNumber();
  return { supply, head };
}
