import { getDefaultConfig } from "connectkit";
import { getBalance } from "@wagmi/core";
import { createConfig, custom } from "wagmi";
import { mainnet } from "wagmi/chains";

// reads go through the connected wallet: no HTTP request of the app
const walletConfig = createConfig(getDefaultConfig({ appName: "Vaults", chains: [mainnet], transports: { [mainnet.id]: custom((window as any).ethereum) } }));

export async function walletBalance(address: `0x${string}`) {
  return getBalance(walletConfig, { address });
}
