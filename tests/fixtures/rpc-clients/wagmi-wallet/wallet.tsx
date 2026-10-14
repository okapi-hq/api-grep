import { createConfig, unstable_connector, useBalance, useReadContract } from "wagmi";
import { readContract } from "@wagmi/core";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// every request goes through the browser wallet's provider: none is an HTTP request of the app
export const walletConfig = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: { [mainnet.id]: unstable_connector(injected) },
});

const abi = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }] as const;

export function TokenBadge({ token, owner }: { token: `0x${string}`; owner: `0x${string}` }) {
  const symbol = useReadContract({ address: token, abi, functionName: "symbol" });
  const balance = useBalance({ address: owner });
  return { symbol, balance };
}

export async function symbolOf(token: `0x${string}`) {
  return readContract(walletConfig, { address: token, abi, functionName: "symbol" });
}
